"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";
import { invalidateSettingsCache } from "@/lib/settings";
import { formatPaise } from "@/lib/money";
import { PAYOUT_STATUS_META } from "@/lib/enums";

import {
  createCommissionRule,
  deleteCommissionRule,
  saveGlobalCommissionRule,
  saveMarketplaceCharges,
  setCommissionRuleActive,
  updateCommissionRule,
  CHARGES_SETTING_KEY,
} from "./commission-service";
import { recomputeBalanceForSeller, recordLedgerAdjustment } from "./ledger-service";
import {
  generateStatement,
  runMarkEarningsAvailable,
  transitionStatement,
  type GenerateStatementResult,
  type TransitionStatementResult,
} from "./payout-service";
import { listSellerBankAccounts, type BankAccountOption } from "./payout-queries";
import { resolveCommissionForProduct, type CommissionResolution } from "./queries";
import {
  adjustmentSchema,
  chargesSchema,
  commissionRuleSchema,
  generatePayoutSchema,
  globalRuleSchema,
  payoutTransitionSchema,
  recomputeBalanceSchema,
  toggleRuleSchema,
  type AdjustmentInput,
  type ChargesInput,
  type CommissionRuleInput,
  type GeneratePayoutFormInput,
  type GlobalRuleInput,
  type PayoutTransitionInput,
} from "./ui-schemas";

/**
 * Server Actions behind /admin/commissions and /admin/payouts.
 *
 * Each is a thin wrapper in the house shape - permission → Zod → service →
 * revalidate → ActionResult - so the REST handlers in
 * `src/app/api/admin/{commissions,payouts}/**` can call the very same services
 * and can never drift from what the screens do.
 *
 * Commission edits deliberately do NOT invalidate the public cache: commission
 * is admin-only money data that the storefront never reads (§14.D11).
 */

const COMMISSIONS_PATH = "/admin/commissions";
const PAYOUTS_PATH = "/admin/payouts";

// ---------------------------------------------------------------------------
// Commission rules
// ---------------------------------------------------------------------------

export async function createCommissionRuleAction(
  input: CommissionRuleInput,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("commissions.manage");
    const parsed = commissionRuleSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const rule = await createCommissionRule(parsed.data, actor);
    revalidatePath(COMMISSIONS_PATH);
    return ok({ id: rule.id }, "Commission rule created.");
  });
}

export async function updateCommissionRuleAction(
  id: string,
  input: CommissionRuleInput,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("commissions.manage");
    const parsed = commissionRuleSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const rule = await updateCommissionRule(id, parsed.data, actor);
    revalidatePath(COMMISSIONS_PATH);
    return ok({ id: rule.id }, "Commission rule saved.");
  });
}

export async function saveGlobalRuleAction(
  input: GlobalRuleInput,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("commissions.manage");
    const parsed = globalRuleSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const rule = await saveGlobalCommissionRule(parsed.data, actor);
    revalidatePath(COMMISSIONS_PATH);
    return ok({ id: rule.id }, "Global commission saved.");
  });
}

export async function setCommissionRuleActiveAction(
  id: string,
  isActive: boolean,
): Promise<ActionResult<{ id: string; isActive: boolean }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("commissions.manage");
    const parsed = toggleRuleSchema.safeParse({ isActive });
    if (!parsed.success) return zodFail(parsed.error);

    const rule = await setCommissionRuleActive(id, parsed.data.isActive, actor);
    revalidatePath(COMMISSIONS_PATH);
    return ok(
      { id: rule.id, isActive: rule.isActive },
      rule.isActive ? "Rule activated." : "Rule deactivated.",
    );
  });
}

export async function deleteCommissionRuleAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("commissions.manage");
    const result = await deleteCommissionRule(id, actor);
    revalidatePath(COMMISSIONS_PATH);
    return ok({ id: result.id }, "Commission rule deleted.");
  });
}

export async function saveChargesAction(input: ChargesInput): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("commissions.manage");
    const parsed = chargesSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const rules = await saveMarketplaceCharges(parsed.data.charges, actor);
    // The order pipeline reads this setting uncached inside its transaction;
    // the admin settings screens read it through the 60s cache, so that copy
    // has to be dropped or the two would disagree for a minute.
    invalidateSettingsCache([CHARGES_SETTING_KEY]);
    revalidatePath(COMMISSIONS_PATH);
    revalidatePath("/admin/settings");
    return ok(
      { count: rules.length },
      `${rules.length} marketplace charge${rules.length === 1 ? "" : "s"} saved.`,
    );
  });
}

// ---------------------------------------------------------------------------
// Payout statements
// ---------------------------------------------------------------------------

export async function generatePayoutAction(
  input: GeneratePayoutFormInput,
): Promise<ActionResult<GenerateStatementResult>> {
  // Explicit type argument: the held/created union would otherwise be inferred
  // from whichever branch returns first.
  return runAction<GenerateStatementResult>(async () => {
    const actor = await requirePermissionOrThrow("payouts.approve");
    const parsed = generatePayoutSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await generateStatement(parsed.data, actor);
    revalidatePath(PAYOUTS_PATH);
    revalidatePath(`/admin/sellers/${result.sellerId}`);

    if (result.held) {
      // Not a failure: the money is still owed and carries forward. Saying so
      // is more useful than a red toast the operator cannot act on.
      return ok(
        result,
        `Nothing to pay yet - ${formatPaise(result.netPaise)} available is at or below the ${formatPaise(result.minPayoutPaise)} minimum. It carries forward.`,
      );
    }
    return ok(result, `Statement ${result.payoutNumber} created for ${formatPaise(result.netPaise)}.`);
  });
}

/** Permission per target status (D14): approve vs process are separate duties. */
function transitionPermission(toStatus: string): string {
  return toStatus === "APPROVED" || toStatus === "CANCELLED" ? "payouts.approve" : "payouts.process";
}

export async function transitionPayoutAction(
  payoutId: string,
  input: PayoutTransitionInput,
): Promise<ActionResult<TransitionStatementResult>> {
  return runAction(async () => {
    const parsed = payoutTransitionSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const actor = await requirePermissionOrThrow(transitionPermission(parsed.data.toStatus));
    const result = await transitionStatement(payoutId, parsed.data, actor);

    revalidatePath(PAYOUTS_PATH);
    revalidatePath(`${PAYOUTS_PATH}/${payoutId}`);
    revalidatePath(`/admin/sellers/${result.sellerId}`);

    const released =
      result.releasedEntries > 0
        ? ` ${result.releasedEntries} entr${result.releasedEntries === 1 ? "y is" : "ies are"} available again.`
        : "";
    return ok(
      result,
      `${result.payoutNumber} is now ${PAYOUT_STATUS_META[result.toStatus].label.toLowerCase()}.${released}`,
    );
  });
}

export async function markEarningsAvailableAction(): Promise<
  ActionResult<{ updated: number; sellers: number }>
> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("payouts.process");
    const result = await runMarkEarningsAvailable(actor);
    revalidatePath(PAYOUTS_PATH);
    return ok(
      result,
      result.updated === 0
        ? "Nothing was due - every held earning is still inside its hold period or blocked by an open return."
        : `${result.updated} entr${result.updated === 1 ? "y" : "ies"} released across ${result.sellers} seller${result.sellers === 1 ? "" : "s"}.`,
    );
  });
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export async function recordAdjustmentAction(
  input: AdjustmentInput,
): Promise<ActionResult<{ entryId: string; sellerId: string; availablePaise: number }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("payouts.adjust");
    const parsed = adjustmentSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await recordLedgerAdjustment(parsed.data, actor);
    revalidatePath(PAYOUTS_PATH);
    revalidatePath(`/admin/sellers/${result.sellerId}`);
    return ok(
      { entryId: result.entryId, sellerId: result.sellerId, availablePaise: result.balance.availablePaise },
      `${formatPaise(Math.abs(result.amountPaise))} ${result.amountPaise >= 0 ? "credited to" : "debited from"} ${result.sellerName}.`,
    );
  });
}

export async function recomputeBalanceAction(
  sellerId: string,
): Promise<ActionResult<{ sellerId: string; availablePaise: number; changed: boolean }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("payouts.process");
    const parsed = recomputeBalanceSchema.safeParse({ sellerId });
    if (!parsed.success) return zodFail(parsed.error);

    const result = await recomputeBalanceForSeller(parsed.data.sellerId, actor);
    const changed =
      !result.before ||
      result.before.pendingPaise !== result.after.pendingPaise ||
      result.before.availablePaise !== result.after.availablePaise ||
      result.before.scheduledPaise !== result.after.scheduledPaise ||
      result.before.paidPaise !== result.after.paidPaise;

    revalidatePath(PAYOUTS_PATH);
    revalidatePath(`/admin/sellers/${result.sellerId}`);
    return ok(
      { sellerId: result.sellerId, availablePaise: result.after.availablePaise, changed },
      changed
        ? `${result.sellerName}'s balance was rebuilt from the ledger; ${formatPaise(result.after.availablePaise)} is available.`
        : `${result.sellerName}'s balance already matched the ledger.`,
    );
  });
}

/**
 * The seller's bank accounts, for the generate / mark-processing choosers.
 * Read-only and masked (D4: never more than the last four digits), fetched on
 * dialog open so the balances table does not carry every seller's accounts.
 */
export async function loadBankAccountsAction(
  sellerId: string,
): Promise<ActionResult<BankAccountOption[]>> {
  return runAction(async () => {
    await requirePermissionOrThrow(["payouts.approve", "payouts.process"]);
    return ok(await listSellerBankAccounts(sellerId));
  });
}

/**
 * Preview the resolution chain for a product without leaving the page. Read
 * only, but it is a Server Action rather than a fetch so the tester card can
 * stay a plain client component.
 */
export async function resolveCommissionAction(
  productId: string,
): Promise<ActionResult<CommissionResolution>> {
  return runAction(async () => {
    await requirePermissionOrThrow("commissions.view");
    const resolution = await resolveCommissionForProduct(productId);
    if (!resolution) return fail("That product no longer exists.");
    return ok(resolution);
  });
}
