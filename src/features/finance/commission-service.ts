import type { CommissionRule, Prisma } from "@prisma/client";

import { conflict, notFound, validationError } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  COMMISSION_SCOPE_META,
  commissionTargetKey,
  type CommissionScope,
  type MarketplaceCharge,
} from "@/lib/enums";

import { chargeRowToSetting, type ChargeRowValues, type CommissionRuleValues, type GlobalRuleValues } from "./ui-schemas";

/**
 * Write side for commission rules and the `marketplace.charges` setting
 * (blueprint §14.B3).
 *
 * Deliberately free of `server-only` and `next/*` so a check script or the job
 * worker can exercise the same rules the admin screen does. Cache invalidation
 * and `revalidatePath` therefore belong to the CALLER (actions.ts / the REST
 * route), which is the only layer that knows it is inside Next.
 *
 * Every mutation here runs in one transaction with its audit row: a rule that
 * changed what sellers are paid without a trace of who changed it would be
 * worse than no change at all (§14.D13).
 */

type ClientMeta = { ip?: string | null };

export const CHARGES_SETTING_KEY = "marketplace.charges";

/** Human label for an audit summary, e.g. `Seller rule (SELLER:abc)`. */
function ruleLabel(scope: CommissionScope, targetKey: string): string {
  return `${COMMISSION_SCOPE_META[scope].label} rule (${targetKey})`;
}

function ruleDiffShape(rule: CommissionRule): Record<string, unknown> {
  return {
    scope: rule.scope,
    targetKey: rule.targetKey,
    rateBps: rule.rateBps,
    fixedPaise: rule.fixedPaise,
    isActive: rule.isActive,
    startsAt: rule.startsAt,
    endsAt: rule.endsAt,
    note: rule.note,
  };
}

/**
 * A rule that points at a deleted category/seller/product would resolve to
 * nothing and silently stop applying, so the target is verified before the row
 * is written rather than being discovered months later on a payout statement.
 */
async function assertTargetExists(
  tx: Prisma.TransactionClient,
  scope: CommissionScope,
  targetId: string | null,
): Promise<void> {
  if (scope === "GLOBAL") return;
  if (!targetId) throw validationError({ targetId: "Choose what this rule applies to." });

  const exists =
    scope === "CATEGORY"
      ? await tx.category.findUnique({ where: { id: targetId }, select: { id: true } })
      : scope === "SELLER"
        ? await tx.seller.findFirst({ where: { id: targetId, deletedAt: null }, select: { id: true } })
        : await tx.product.findFirst({ where: { id: targetId, deletedAt: null }, select: { id: true } });

  if (!exists) {
    throw validationError({ targetId: `That ${COMMISSION_SCOPE_META[scope].label.toLowerCase()} no longer exists.` });
  }
}

/** Split a `CommissionRuleValues.targetId` onto the three nullable FK columns. */
function targetColumns(scope: CommissionScope, targetId: string | null) {
  return {
    categoryId: scope === "CATEGORY" ? targetId : null,
    sellerId: scope === "SELLER" ? targetId : null,
    productId: scope === "PRODUCT" ? targetId : null,
  };
}

export async function createCommissionRule(
  input: CommissionRuleValues,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<CommissionRule> {
  const targetId = input.scope === "GLOBAL" ? null : input.targetId;
  const targetKey = commissionTargetKey(input.scope, targetId);

  return db.$transaction(async (tx) => {
    await assertTargetExists(tx, input.scope, targetId);

    // Pre-checked rather than caught: in Postgres a unique violation aborts
    // the whole transaction, so a P2002 could not be turned into a friendly
    // 409 without losing the audit write alongside it.
    const clash = await tx.commissionRule.findUnique({
      where: { targetKey },
      select: { id: true, isActive: true },
    });
    if (clash) {
      throw conflict(
        `A ${COMMISSION_SCOPE_META[input.scope].label.toLowerCase()} rule already exists for this target. Edit it instead of creating a second one.`,
        { targetId: "A rule already covers this target." },
      );
    }

    const rule = await tx.commissionRule.create({
      data: {
        scope: input.scope,
        targetKey,
        ...targetColumns(input.scope, targetId),
        rateBps: input.rateBps,
        fixedPaise: input.fixedPaise,
        isActive: input.isActive,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        note: input.note,
      },
    });

    await writeAudit(tx, {
      actor,
      action: "commission_rule.create",
      entityType: "CommissionRule",
      entityId: rule.id,
      entityLabel: ruleLabel(input.scope, targetKey),
      summary: `Created ${ruleLabel(input.scope, targetKey)}`,
      diff: diffOf(null, ruleDiffShape(rule)),
      ip: meta.ip,
    });

    return rule;
  });
}

export async function updateCommissionRule(
  id: string,
  input: CommissionRuleValues,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<CommissionRule> {
  return db.$transaction(async (tx) => {
    const before = await tx.commissionRule.findUnique({ where: { id } });
    if (!before) throw notFound("Commission rule");

    const scope = input.scope;
    // A GLOBAL row can never become scoped and vice versa: the rest of the
    // system resolves through targetKey, and a moved key would orphan every
    // OrderItem.commissionRuleId snapshot that points here.
    if ((before.scope === "GLOBAL") !== (scope === "GLOBAL")) {
      throw validationError({ scope: "A global rule cannot be re-scoped. Create a new rule instead." });
    }

    const targetId = scope === "GLOBAL" ? null : input.targetId;
    const targetKey = commissionTargetKey(scope, targetId);
    await assertTargetExists(tx, scope, targetId);

    if (targetKey !== before.targetKey) {
      const clash = await tx.commissionRule.findUnique({ where: { targetKey }, select: { id: true } });
      if (clash) {
        throw conflict("Another rule already covers that target.", {
          targetId: "A rule already covers this target.",
        });
      }
    }

    const rule = await tx.commissionRule.update({
      where: { id },
      data: {
        scope,
        targetKey,
        ...targetColumns(scope, targetId),
        rateBps: input.rateBps,
        fixedPaise: input.fixedPaise,
        isActive: input.isActive,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        note: input.note,
      },
    });

    const diff = diffOf(ruleDiffShape(before), ruleDiffShape(rule));
    if (diff) {
      await writeAudit(tx, {
        actor,
        action: "commission_rule.update",
        entityType: "CommissionRule",
        entityId: rule.id,
        entityLabel: ruleLabel(scope, targetKey),
        summary: `Updated ${ruleLabel(scope, targetKey)}`,
        diff,
        ip: meta.ip,
      });
    }

    return rule;
  });
}

/**
 * The GLOBAL card. Upserts rather than requiring the row to exist, because
 * `resolveCommission` falls back to 0% when it is missing and an operator
 * should be able to fix that from the screen that shows it.
 */
export async function saveGlobalCommissionRule(
  input: GlobalRuleValues,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<CommissionRule> {
  const targetKey = commissionTargetKey("GLOBAL");

  return db.$transaction(async (tx) => {
    const before = await tx.commissionRule.findUnique({ where: { targetKey } });
    const rule = await tx.commissionRule.upsert({
      where: { targetKey },
      create: {
        scope: "GLOBAL",
        targetKey,
        rateBps: input.rateBps,
        fixedPaise: input.fixedPaise,
        note: input.note,
        isActive: true,
      },
      update: {
        rateBps: input.rateBps,
        fixedPaise: input.fixedPaise,
        note: input.note,
        // Saving the global card re-activates it: an inactive global rule
        // means every uncovered sale earns the platform nothing.
        isActive: true,
      },
    });

    const diff = diffOf(before ? ruleDiffShape(before) : null, ruleDiffShape(rule));
    if (diff) {
      await writeAudit(tx, {
        actor,
        action: before ? "commission_rule.update" : "commission_rule.create",
        entityType: "CommissionRule",
        entityId: rule.id,
        entityLabel: "Global rule",
        summary: `${before ? "Updated" : "Created"} the global commission rule`,
        diff,
        ip: meta.ip,
      });
    }

    return rule;
  });
}

export async function setCommissionRuleActive(
  id: string,
  isActive: boolean,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<CommissionRule> {
  return db.$transaction(async (tx) => {
    const before = await tx.commissionRule.findUnique({ where: { id } });
    if (!before) throw notFound("Commission rule");
    if (before.scope === "GLOBAL" && !isActive) {
      throw conflict(
        "The global rule is the fallback for every uncovered sale. Set its rate to 0% instead of switching it off.",
      );
    }
    if (before.isActive === isActive) return before;

    const rule = await tx.commissionRule.update({ where: { id }, data: { isActive } });
    await writeAudit(tx, {
      actor,
      action: "commission_rule.status_change",
      entityType: "CommissionRule",
      entityId: rule.id,
      entityLabel: ruleLabel(rule.scope as CommissionScope, rule.targetKey),
      summary: `${isActive ? "Activated" : "Deactivated"} ${ruleLabel(rule.scope as CommissionScope, rule.targetKey)}`,
      diff: diffOf({ isActive: before.isActive }, { isActive }),
      ip: meta.ip,
    });
    return rule;
  });
}

export async function deleteCommissionRule(
  id: string,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<{ id: string; targetKey: string }> {
  return db.$transaction(async (tx) => {
    const rule = await tx.commissionRule.findUnique({ where: { id } });
    if (!rule) throw notFound("Commission rule");
    if (rule.scope === "GLOBAL") {
      throw conflict("The global rule cannot be deleted - it is the fallback every other rule falls back to.");
    }

    // OrderItem.commissionRuleId is SetNull, so past orders keep their
    // snapshotted rate; only future resolution changes.
    await tx.commissionRule.delete({ where: { id } });
    await writeAudit(tx, {
      actor,
      action: "commission_rule.delete",
      entityType: "CommissionRule",
      entityId: rule.id,
      entityLabel: ruleLabel(rule.scope as CommissionScope, rule.targetKey),
      summary: `Deleted ${ruleLabel(rule.scope as CommissionScope, rule.targetKey)}`,
      diff: diffOf(ruleDiffShape(rule), null),
      ip: meta.ip,
    });

    return { id: rule.id, targetKey: rule.targetKey };
  });
}

// ---------------------------------------------------------------------------
// marketplace.charges (B3)
// ---------------------------------------------------------------------------

/**
 * Writes the whole `marketplace.charges` array in one go. The setting is read
 * uncached by `loadChargeRules()` inside the order transaction, so the caller
 * must still drop the ADMIN settings cache (`invalidateSettingsCache`) for the
 * settings screens to agree with what pricing now uses.
 */
export async function saveMarketplaceCharges(
  rows: readonly ChargeRowValues[],
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<MarketplaceCharge[]> {
  const payload = rows.map(chargeRowToSetting);
  const value = JSON.stringify(payload);

  return db.$transaction(async (tx) => {
    const before = await tx.setting.findUnique({
      where: { key: CHARGES_SETTING_KEY },
      select: { value: true },
    });

    await tx.setting.upsert({
      where: { key: CHARGES_SETTING_KEY },
      create: {
        key: CHARGES_SETTING_KEY,
        value,
        type: "json",
        group: "marketplace",
        label: "Marketplace charges",
        helpText: "[{ code, label, type, valueBps|valuePaise, appliesWhen }] deducted from seller payables.",
      },
      update: { value },
    });

    const diff = diffOf({ charges: before?.value ?? "[]" }, { charges: value });
    if (diff) {
      await writeAudit(tx, {
        actor,
        action: "settings.update",
        entityType: "Setting",
        entityId: CHARGES_SETTING_KEY,
        entityLabel: CHARGES_SETTING_KEY,
        summary: `Updated marketplace charges (${payload.length} rule${payload.length === 1 ? "" : "s"})`,
        diff,
        ip: meta.ip,
      });
    }

    return payload as MarketplaceCharge[];
  });
}
