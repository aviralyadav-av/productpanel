import type { Seller } from "@prisma/client";

import { conflict, notFound, validationError } from "@/lib/api/errors";
import { diffOf, writeAudit } from "@/lib/audit";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { hashToken, randomToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { SELLER_STATUS_META, commissionTargetKey, type SellerStatus } from "@/lib/enums";

import { resolveCommission, type ResolvedCommission } from "@/features/finance/service";
import { readSettingString } from "@/features/finance/settings-reader";
import { emitEvent } from "@/features/notifications/service";

import {
  activationReady,
  actorIdOrNull,
  affectsPublicCatalog,
  applyTransition,
  inTransaction,
  recomputeSellerCounters,
  requireSeller,
  type Db,
  type SellerActor,
} from "@/features/sellers/core";
import type { CommissionOverrideValues, CreateSellerValues, SellerProfileValues } from "@/features/sellers/schemas";

/**
 * Seller mutations (blueprint §1 Sellers, §11.13/14/34, §14.B3, C5, C7, D13).
 *
 * Every write runs in one transaction with its SellerEvent and its audit row:
 * a seller whose status changed without a trace in the timeline is a support
 * ticket waiting to happen. Side effects that must not roll back the business
 * change (storefront cache invalidation) run AFTER commit.
 *
 * No `server-only` / `next/*` imports: the check script and node:test run
 * this as plain tsx (G3). Permission checks live in actions.ts and the REST
 * handlers; this file trusts its caller and enforces the domain rules.
 */

export type { Db, SellerActor } from "@/features/sellers/core";
export {
  activationReady,
  affectsPublicCatalog,
  applyTransition,
  maybeAutoActivate,
  recomputeSellerCounters,
  requireSeller,
  sellerPublicUrl,
} from "@/features/sellers/core";
export {
  addSellerDocument,
  reviewSellerDocument,
  uploadSellerDocument,
  ensureSellerMediaFolder,
  type AddDocumentInput,
  type ReviewDocumentResult,
} from "@/features/sellers/documents";
export {
  addBankAccount,
  updateBankAccount,
  setPrimaryBankAccount,
  verifyBankAccount,
  deleteBankAccount,
  revealBankAccount,
  type BankAccountMutationResult,
  type RevealedBankAccount,
} from "@/features/sellers/bank-accounts";
export {
  registerSeller,
  createPendingSellerUpload,
  REGISTRATION_ACCEPTED_MESSAGE,
  PENDING_UPLOAD_TTL_MS,
  type RegisterSellerResult,
  type PendingSellerUpload,
} from "@/features/sellers/registration";

export const RESET_TOKEN_TTL_MINUTES = 24 * 60;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The profile columns a create/update writes, for diffs and the update itself. */
function profileData(profile: SellerProfileValues) {
  return {
    displayName: profile.displayName,
    slug: profile.slug,
    legalName: profile.legalName ?? null,
    ownerName: profile.ownerName,
    email: profile.email,
    phone: profile.phone ?? null,
    description: profile.description ?? null,
    addressLine1: profile.addressLine1 ?? null,
    addressLine2: profile.addressLine2 ?? null,
    city: profile.city ?? null,
    state: profile.state ?? null,
    pinCode: profile.pinCode ?? null,
    country: profile.country,
    gstin: profile.gstin ?? null,
    pan: profile.pan ?? null,
    logoMediaId: profile.logoMediaId ?? null,
    bannerMediaId: profile.bannerMediaId ?? null,
  };
}

const PROFILE_KEYS = Object.keys(
  profileData({ displayName: "", slug: "", ownerName: "", email: "", country: "IN" } as SellerProfileValues),
);

function pickProfile(seller: Seller): Record<string, unknown> {
  const record = seller as unknown as Record<string, unknown>;
  return Object.fromEntries(PROFILE_KEYS.map((key) => [key, record[key] ?? null]));
}

/**
 * Slug and email are unique across sellers; a pre-check gives the operator a
 * field-level message instead of a bare "already exists" (a P2002 inside a
 * Postgres tx would also abort the whole transaction).
 */
async function assertUniqueIdentity(tx: Db, input: { slug: string; email: string; exceptId?: string }): Promise<void> {
  const clashes = await tx.seller.findMany({
    where: {
      OR: [{ slug: input.slug }, { email: input.email }],
      ...(input.exceptId ? { NOT: { id: input.exceptId } } : {}),
    },
    select: { slug: true, email: true },
  });
  const details: Record<string, string> = {};
  for (const clash of clashes) {
    if (clash.slug === input.slug) details.slug = "Another seller already uses this slug.";
    if (clash.email === input.email) details.email = "Another seller already uses this email.";
  }
  if (Object.keys(details).length > 0) throw validationError(details, "Slug or email is already taken.");
}

async function assertMediaExists(tx: Db, ids: Array<string | null | undefined>): Promise<void> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return;
  const found = await tx.mediaAsset.count({ where: { id: { in: wanted } } });
  if (found !== wanted.length) throw validationError({ logoMediaId: "Pick an image from the media library." });
}

// ---------------------------------------------------------------------------
// Create / update / delete
// ---------------------------------------------------------------------------

export type CreateSellerResult = { seller: Seller; commissionRuleId: string | null };

/**
 * Admin-side registration. The seller starts PENDING or, when the operator
 * vouches for them, straight at ACTIVE - both recorded as the first
 * SellerEvent so the timeline never begins in the middle.
 */
export async function createSeller(input: CreateSellerValues, actor: SellerActor): Promise<CreateSellerResult> {
  const result = await db.$transaction(async (tx) => {
    await assertUniqueIdentity(tx, { slug: input.profile.slug, email: input.profile.email });
    await assertMediaExists(tx, [input.profile.logoMediaId, input.profile.bannerMediaId]);

    const now = new Date();
    const active = input.initialStatus === "ACTIVE";
    const seller = await tx.seller.create({
      data: {
        ...profileData(input.profile),
        status: input.initialStatus,
        approvedAt: active ? now : null,
        approvedById: active ? actorIdOrNull(actor) : null,
        lastActiveAt: active ? now : null,
      },
    });

    await tx.sellerEvent.create({
      data: {
        sellerId: seller.id,
        fromStatus: null,
        toStatus: seller.status,
        message: `Created from the admin as ${SELLER_STATUS_META[input.initialStatus].label.toLowerCase()}.`,
        actorId: actorIdOrNull(actor),
      },
    });

    let commissionRuleId: string | null = null;
    if (input.commissionBps !== null && input.commissionBps !== undefined) {
      const rule = await tx.commissionRule.create({
        data: {
          scope: "SELLER",
          targetKey: commissionTargetKey("SELLER", seller.id),
          sellerId: seller.id,
          rateBps: input.commissionBps,
          fixedPaise: 0,
          isActive: true,
          note: "Set at seller creation.",
        },
        select: { id: true },
      });
      commissionRuleId = rule.id;
    }

    await writeAudit(tx, {
      actor,
      action: "seller.create",
      entityType: "Seller",
      entityId: seller.id,
      entityLabel: seller.displayName,
      summary: `Created seller "${seller.displayName}" (${seller.status.toLowerCase()})${
        commissionRuleId ? ` with a ${(input.commissionBps ?? 0) / 100}% commission override` : ""
      }.`,
      diff: diffOf(null, { ...pickProfile(seller), status: seller.status, commissionBps: input.commissionBps ?? null }),
    });

    return { seller, commissionRuleId };
  });

  if (result.seller.status === "ACTIVE") await invalidatePublic(listTagsFor("seller"));
  return result;
}

export async function updateSeller(id: string, profile: SellerProfileValues, actor: SellerActor): Promise<Seller> {
  const { seller, changed } = await db.$transaction(async (tx) => {
    const before = await requireSeller(tx, id);
    await assertUniqueIdentity(tx, { slug: profile.slug, email: profile.email, exceptId: id });
    await assertMediaExists(tx, [profile.logoMediaId, profile.bannerMediaId]);

    const after = await tx.seller.update({ where: { id }, data: profileData(profile) });
    const diff = diffOf(pickProfile(before), pickProfile(after));

    if (diff) {
      await writeAudit(tx, {
        actor,
        action: "seller.update",
        entityType: "Seller",
        entityId: id,
        entityLabel: after.displayName,
        summary: `Updated seller profile "${after.displayName}".`,
        diff,
      });
    }
    return { seller: after, changed: Boolean(diff) };
  });

  // The public profile (name, logo, description, city) is cached under catalog/content.
  if (changed && seller.status === "ACTIVE") await invalidatePublic(listTagsFor("seller"));
  return seller;
}

/**
 * Soft delete only (§11.14): a seller with catalogue or order history is
 * refused, because their order lines, ledger and payouts reference them. The
 * slug and email are suffixed so the identity can be re-registered (§11.34).
 */
export async function softDeleteSeller(id: string, actor: SellerActor, reason?: string | null): Promise<Seller> {
  const seller = await db.$transaction(async (tx) => {
    const before = await requireSeller(tx, id);
    const [products, orderItems] = await Promise.all([
      tx.product.count({ where: { sellerId: id, deletedAt: null } }),
      tx.orderItem.count({ where: { sellerId: id } }),
    ]);
    if (products > 0 || orderItems > 0) {
      throw conflict(
        `"${before.displayName}" has ${products} product${products === 1 ? "" : "s"} and ${orderItems} order line${
          orderItems === 1 ? "" : "s"
        }; suspend the seller instead of deleting.`,
        { products: String(products), orderItems: String(orderItems) },
      );
    }

    const stamp = Date.now();
    const after = await tx.seller.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        slug: `${before.slug}-deleted-${stamp}`,
        email: `${before.id}.deleted-${stamp}@deleted.local`,
      },
    });
    await tx.sellerEvent.create({
      data: {
        sellerId: id,
        fromStatus: before.status,
        toStatus: before.status,
        message: reason ? `Deleted: ${reason}` : "Deleted from the admin.",
        actorId: actorIdOrNull(actor),
      },
    });
    await writeAudit(tx, {
      actor,
      action: "seller.delete",
      entityType: "Seller",
      entityId: id,
      entityLabel: before.displayName,
      summary: `Soft-deleted seller "${before.displayName}"${reason ? `: ${reason}` : ""}.`,
      diff: diffOf(
        { slug: before.slug, email: before.email, deletedAt: null },
        { slug: after.slug, email: after.email, deletedAt: after.deletedAt },
      ),
    });
    return after;
  });

  if (seller.status === "ACTIVE") await invalidatePublic(listTagsFor("seller"));
  return seller;
}

// ---------------------------------------------------------------------------
// State machine (C5)
// ---------------------------------------------------------------------------

export type TransitionSellerInput = {
  sellerId: string;
  toStatus: SellerStatus;
  actor: SellerActor;
  reason?: string | null;
  /** With APPROVED: continue to ACTIVE in the same transaction when KYC + bank are in place. */
  activate?: boolean;
  tx?: Db;
};

export type TransitionSellerResult = {
  seller: Seller;
  fromStatus: SellerStatus;
  /** Every status reached in this call, e.g. ["APPROVED", "ACTIVE"]. */
  path: SellerStatus[];
  /** True when "Approve & activate" could not continue to ACTIVE. */
  activationSkipped: boolean;
};

export async function transitionSeller(input: TransitionSellerInput): Promise<TransitionSellerResult> {
  const result = await inTransaction(input.tx, async (tx) => {
    const seller = await requireSeller(tx, input.sellerId);
    const fromStatus = seller.status as SellerStatus;
    const path: SellerStatus[] = [];
    let current = await applyTransition(tx, seller, { toStatus: input.toStatus, actor: input.actor, reason: input.reason });
    path.push(input.toStatus);

    let activationSkipped = false;
    if (input.toStatus === "APPROVED" && input.activate) {
      if (await activationReady(tx, seller.id)) {
        current = await applyTransition(tx, current, {
          toStatus: "ACTIVE",
          actor: input.actor,
          message: "Activated with approval: verified KYC document and primary bank account on file.",
        });
        path.push("ACTIVE");
      } else {
        activationSkipped = true;
      }
    }

    if (path.includes("ACTIVE") || fromStatus === "ACTIVE") {
      await recomputeSellerCounters(tx, seller.id);
    }
    return { seller: current, fromStatus, path, activationSkipped };
  });

  if (affectsPublicCatalog(result.fromStatus, result.seller.status as SellerStatus)) {
    await invalidatePublic(listTagsFor("seller"));
  }
  return result;
}

export type BulkTransitionResult = {
  changed: string[];
  skipped: Array<{ id: string; reason: string }>;
};

/**
 * Same edge applied to many sellers; each seller gets its own transaction so
 * one illegal edge (a stale row selected before someone else acted) does not
 * undo the rest. The bulk itself is audited with the id count (D13).
 */
export async function bulkTransitionSellers(input: {
  ids: readonly string[];
  toStatus: SellerStatus;
  actor: SellerActor;
  reason?: string | null;
}): Promise<BulkTransitionResult> {
  const result: BulkTransitionResult = { changed: [], skipped: [] };
  let touchesPublic = false;

  for (const id of input.ids) {
    try {
      const from = await db.$transaction(async (tx) => {
        const seller = await requireSeller(tx, id);
        await applyTransition(tx, seller, { toStatus: input.toStatus, actor: input.actor, reason: input.reason });
        return seller.status as SellerStatus;
      });
      result.changed.push(id);
      if (affectsPublicCatalog(from, input.toStatus)) touchesPublic = true;
    } catch (error) {
      result.skipped.push({ id, reason: error instanceof Error ? error.message : "Unknown error." });
    }
  }

  await writeAudit({
    actor: input.actor,
    action: "seller.bulk_status_change",
    entityType: "Seller",
    summary: `Bulk ${input.toStatus.toLowerCase()}: ${result.changed.length} changed, ${result.skipped.length} skipped${
      input.reason ? ` (${input.reason})` : ""
    }.`,
    diff: {
      toStatus: input.toStatus,
      requested: input.ids.length,
      changed: result.changed.length,
      skipped: result.skipped.length,
    },
  });

  if (touchesPublic) await invalidatePublic(listTagsFor("seller"));
  return result;
}

// ---------------------------------------------------------------------------
// Commission override (B3)
// ---------------------------------------------------------------------------

export type SellerCommissionOverride = {
  id: string;
  rateBps: number;
  fixedPaise: number;
  note: string | null;
  isActive: boolean;
  updatedAt: Date;
};

export type SellerCommissionView = {
  /** What an order line for this seller would snapshot today. */
  resolved: ResolvedCommission;
  /** The SELLER:<id> rule, active or not; null when the seller inherits. */
  override: SellerCommissionOverride | null;
};

export async function getSellerCommission(sellerId: string, tx?: Db): Promise<SellerCommissionView> {
  const client = tx ?? db;
  const [resolved, override] = await Promise.all([
    resolveCommission(tx, { sellerId }),
    client.commissionRule.findUnique({
      where: { targetKey: commissionTargetKey("SELLER", sellerId) },
      select: { id: true, rateBps: true, fixedPaise: true, note: true, isActive: true, updatedAt: true },
    }),
  ]);
  return { resolved, override };
}

export async function upsertCommissionOverride(
  sellerId: string,
  input: CommissionOverrideValues,
  actor: SellerActor,
): Promise<SellerCommissionView> {
  await db.$transaction(async (tx) => {
    const seller = await requireSeller(tx, sellerId);
    const targetKey = commissionTargetKey("SELLER", sellerId);
    const before = await tx.commissionRule.findUnique({ where: { targetKey } });
    const after = await tx.commissionRule.upsert({
      where: { targetKey },
      create: {
        scope: "SELLER",
        targetKey,
        sellerId,
        rateBps: input.rateBps,
        fixedPaise: input.fixedPaise,
        note: input.note ?? null,
        isActive: true,
      },
      update: {
        rateBps: input.rateBps,
        fixedPaise: input.fixedPaise,
        note: input.note ?? null,
        isActive: true,
        startsAt: null,
        endsAt: null,
      },
    });
    await writeAudit(tx, {
      actor,
      action: "seller.commission_change",
      entityType: "Seller",
      entityId: sellerId,
      entityLabel: seller.displayName,
      summary: `Commission override for "${seller.displayName}" set to ${after.rateBps / 100}%${
        after.fixedPaise ? ` + ${after.fixedPaise} paise per unit` : ""
      }.`,
      diff: diffOf(
        before ? { rateBps: before.rateBps, fixedPaise: before.fixedPaise, note: before.note, isActive: before.isActive } : null,
        { rateBps: after.rateBps, fixedPaise: after.fixedPaise, note: after.note, isActive: after.isActive },
      ),
    });
  });
  return getSellerCommission(sellerId);
}

export async function deleteCommissionOverride(sellerId: string, actor: SellerActor): Promise<SellerCommissionView> {
  await db.$transaction(async (tx) => {
    const seller = await requireSeller(tx, sellerId);
    const targetKey = commissionTargetKey("SELLER", sellerId);
    const before = await tx.commissionRule.findUnique({ where: { targetKey } });
    if (!before) throw notFound("Commission override");
    await tx.commissionRule.delete({ where: { targetKey } });
    await writeAudit(tx, {
      actor,
      action: "seller.commission_change",
      entityType: "Seller",
      entityId: sellerId,
      entityLabel: seller.displayName,
      summary: `Removed the commission override for "${seller.displayName}" (was ${before.rateBps / 100}%).`,
      diff: diffOf({ rateBps: before.rateBps, fixedPaise: before.fixedPaise, note: before.note }, null),
    });
  });
  return getSellerCommission(sellerId);
}

// ---------------------------------------------------------------------------
// Reset access (C5)
// ---------------------------------------------------------------------------

export type ResetAccessResult = { expiresAt: Date; emailQueued: boolean };

/**
 * Issue a single-use, hashed reset token and email the storefront's reset
 * link `<storefront.base_url>/seller/reset-password/<token>`. Admins never
 * see or set the password; the plaintext token exists only inside the email.
 * Older unused tokens are dropped so exactly one link is live at a time.
 */
export async function resetSellerAccess(sellerId: string, actor: SellerActor): Promise<ResetAccessResult> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000);

  return db.$transaction(async (tx) => {
    const seller = await requireSeller(tx, sellerId);
    await tx.sellerPasswordResetToken.deleteMany({ where: { sellerId, usedAt: null } });
    await tx.sellerPasswordResetToken.create({ data: { sellerId, tokenHash: hashToken(token), expiresAt } });

    const base = (await readSettingString(tx, "storefront.base_url")).replace(/\/+$/, "");
    const emitted = await emitEvent(
      "seller.password_reset",
      {
        sellerId,
        sellerName: seller.displayName,
        sellerEmail: seller.email,
        resetUrl: `${base}/seller/reset-password/${token}`,
        expiresMinutes: RESET_TOKEN_TTL_MINUTES,
      },
      tx,
    );

    await tx.sellerEvent.create({
      data: {
        sellerId,
        fromStatus: seller.status,
        toStatus: seller.status,
        message: "Access reset link sent.",
        actorId: actorIdOrNull(actor),
      },
    });
    await writeAudit(tx, {
      actor,
      action: "seller.reset_access",
      entityType: "Seller",
      entityId: sellerId,
      entityLabel: seller.displayName,
      summary: `Sent a password reset link to ${seller.email} (valid ${RESET_TOKEN_TTL_MINUTES / 60} h).`,
      diff: { expiresAt: expiresAt.toISOString() },
    });

    return { expiresAt, emailQueued: emitted.email?.queued ?? false };
  });
}
