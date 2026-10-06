"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { can, requirePermissionOrThrow } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { SELLER_STATUS_META, type SellerStatus } from "@/lib/enums";

import {
  bankAccountSchema,
  bankAccountUpdateSchema,
  bulkSellerStatusSchema,
  commissionOverrideSchema,
  createSellerSchema,
  looseIdSchema,
  permissionForTransition,
  reviewDocumentSchema,
  transitionLabel,
  transitionSellerSchema,
  updateSellerSchema,
  type BankAccountInput,
  type BankAccountUpdateInput,
  type BulkSellerStatusInput,
  type CommissionOverrideInput,
  type CreateSellerInput,
  type ReviewDocumentInput,
  type TransitionSellerInput,
  type UpdateSellerInput,
} from "@/features/sellers/schemas";
import {
  addBankAccount,
  bulkTransitionSellers,
  createSeller,
  deleteBankAccount,
  deleteCommissionOverride,
  resetSellerAccess,
  revealBankAccount,
  reviewSellerDocument,
  setPrimaryBankAccount,
  softDeleteSeller,
  transitionSeller,
  updateBankAccount,
  updateSeller,
  upsertCommissionOverride,
  verifyBankAccount,
  type BankAccountMutationResult,
  type BulkTransitionResult,
  type RevealedBankAccount,
  type SellerCommissionView,
} from "@/features/sellers/service";

/**
 * Server Actions behind /admin/sellers (blueprint §14.D10, G-house style):
 * permission → Zod → service → revalidate → ActionResult. Each is a thin
 * wrapper; the rules live in service.ts so the REST routes share them.
 */

const LIST_PATH = "/admin/sellers";

function revalidateSeller(id?: string): void {
  revalidatePath(LIST_PATH);
  if (id) revalidatePath(`/admin/sellers/${id}`);
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function createSellerAction(input: CreateSellerInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("sellers.create");
    const parsed = createSellerSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    if (parsed.data.commissionBps !== null && parsed.data.commissionBps !== undefined && !can(actor, "commissions.manage")) {
      return fail("You need the commissions.manage permission to set a commission override.", {
        commissionBps: "Not permitted.",
      });
    }
    const { seller } = await createSeller(parsed.data, actor);
    revalidateSeller(seller.id);
    return ok({ id: seller.id }, `Seller "${seller.displayName}" created.`);
  });
}

export async function updateSellerAction(input: UpdateSellerInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("sellers.edit");
    const parsed = updateSellerSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const seller = await updateSeller(parsed.data.id, parsed.data.profile, actor);
    revalidateSeller(seller.id);
    return ok({ id: seller.id }, "Seller profile saved.");
  });
}

export async function deleteSellerAction(id: string, reason?: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("sellers.delete");
    const parsedId = looseIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid seller id.");
    const seller = await softDeleteSeller(parsedId.data, actor, reason);
    revalidateSeller(seller.id);
    return ok({ id: seller.id }, `Seller "${seller.displayName}" deleted.`);
  });
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export type TransitionActionData = { id: string; status: SellerStatus; path: SellerStatus[]; activationSkipped: boolean };

export async function transitionSellerAction(input: TransitionSellerInput): Promise<ActionResult<TransitionActionData>> {
  return runAction(async () => {
    const parsed = transitionSellerSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    // The permission depends on the edge (approve vs suspend), which depends
    // on the current status - so read it first, then guard.
    const current = await db.seller.findUnique({ where: { id: parsed.data.id }, select: { status: true, deletedAt: true } });
    if (!current || current.deletedAt) return fail("Seller not found.");
    const actor = await requirePermissionOrThrow(permissionForTransition(current.status as SellerStatus, parsed.data.toStatus));

    const result = await transitionSeller({
      sellerId: parsed.data.id,
      toStatus: parsed.data.toStatus,
      actor,
      reason: parsed.data.reason,
      activate: parsed.data.activate,
    });
    revalidateSeller(result.seller.id);

    const finalStatus = result.seller.status as SellerStatus;
    const message = result.activationSkipped
      ? `Approved. Not activated yet: a verified KYC document and a primary bank account are still needed.`
      : `${transitionLabel(result.fromStatus, parsed.data.toStatus)} done - seller is now ${SELLER_STATUS_META[finalStatus].label.toLowerCase()}.`;
    return ok(
      { id: result.seller.id, status: finalStatus, path: result.path, activationSkipped: result.activationSkipped },
      message,
    );
  });
}

export async function bulkSellerStatusAction(input: BulkSellerStatusInput): Promise<ActionResult<BulkTransitionResult>> {
  return runAction(async () => {
    const parsed = bulkSellerStatusSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const actor = await requirePermissionOrThrow(parsed.data.toStatus === "SUSPENDED" ? "sellers.suspend" : "sellers.approve");

    const result = await bulkTransitionSellers({
      ids: parsed.data.ids,
      toStatus: parsed.data.toStatus,
      actor,
      reason: parsed.data.reason,
    });
    revalidateSeller();
    for (const id of result.changed) revalidatePath(`/admin/sellers/${id}`);

    const parts = [`${result.changed.length} updated`];
    if (result.skipped.length > 0) parts.push(`${result.skipped.length} skipped (not eligible)`);
    return ok(result, `${parts.join(", ")}.`);
  });
}

export async function resetSellerAccessAction(id: string): Promise<ActionResult<{ expiresAt: string; emailQueued: boolean }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("sellers.edit");
    const parsedId = looseIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid seller id.");
    const result = await resetSellerAccess(parsedId.data, actor);
    revalidateSeller(parsedId.data);
    return ok(
      { expiresAt: result.expiresAt.toISOString(), emailQueued: result.emailQueued },
      result.emailQueued ? "Reset link emailed to the seller (valid 24 hours)." : "Reset link issued; the email could not be queued - check the email templates.",
    );
  });
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function reviewDocumentAction(input: ReviewDocumentInput): Promise<ActionResult<{ autoActivated: boolean }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("sellers.approve");
    const parsed = reviewDocumentSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await reviewSellerDocument({ ...parsed.data, actor });
    revalidateSeller(parsed.data.sellerId);
    return ok(
      { autoActivated: result.autoActivated },
      result.autoActivated
        ? "Document verified - the seller is now active."
        : parsed.data.status === "VERIFIED"
          ? "Document verified."
          : "Document rejected.",
    );
  });
}

// ---------------------------------------------------------------------------
// Bank accounts
// ---------------------------------------------------------------------------

export async function addBankAccountAction(
  sellerId: string,
  input: BankAccountInput,
): Promise<ActionResult<BankAccountMutationResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("sellers.edit");
    const parsedId = looseIdSchema.safeParse(sellerId);
    if (!parsedId.success) return fail("Invalid seller id.");
    const parsed = bankAccountSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await addBankAccount(parsedId.data, parsed.data, actor);
    revalidateSeller(parsedId.data);
    return ok(result.account, result.autoActivated ? "Bank account added - the seller is now active." : "Bank account added.");
  });
}

export async function updateBankAccountAction(
  sellerId: string,
  accountId: string,
  input: BankAccountUpdateInput,
): Promise<ActionResult<BankAccountMutationResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("sellers.edit");
    const ids = looseIdSchema.safeParse(sellerId).success && looseIdSchema.safeParse(accountId).success;
    if (!ids) return fail("Invalid id.");
    const parsed = bankAccountUpdateSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const account = await updateBankAccount(sellerId, accountId, parsed.data, actor);
    revalidateSeller(sellerId);
    return ok(account, "Bank account updated.");
  });
}

export async function setPrimaryBankAccountAction(sellerId: string, accountId: string): Promise<ActionResult<BankAccountMutationResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("sellers.edit");
    const result = await setPrimaryBankAccount(sellerId, accountId, actor);
    revalidateSeller(sellerId);
    return ok(result.account, result.autoActivated ? "Primary account set - the seller is now active." : "Primary account set.");
  });
}

export async function verifyBankAccountAction(sellerId: string, accountId: string): Promise<ActionResult<BankAccountMutationResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("sellers.approve");
    const account = await verifyBankAccount(sellerId, accountId, actor);
    revalidateSeller(sellerId);
    return ok(account, "Bank account marked verified.");
  });
}

export async function deleteBankAccountAction(sellerId: string, accountId: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("sellers.edit");
    await deleteBankAccount(sellerId, accountId, actor);
    revalidateSeller(sellerId);
    return ok({ id: accountId }, "Bank account deleted.");
  });
}

/** D4: the single reveal path; `payouts.process` only, audited in the service. */
export async function revealBankAccountAction(sellerId: string, accountId: string): Promise<ActionResult<RevealedBankAccount>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("payouts.process");
    const revealed = await revealBankAccount(sellerId, accountId, actor);
    return ok(revealed);
  });
}

// ---------------------------------------------------------------------------
// Commission override
// ---------------------------------------------------------------------------

export async function upsertCommissionOverrideAction(
  sellerId: string,
  input: CommissionOverrideInput,
): Promise<ActionResult<SellerCommissionView>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("commissions.manage");
    const parsedId = looseIdSchema.safeParse(sellerId);
    if (!parsedId.success) return fail("Invalid seller id.");
    const parsed = commissionOverrideSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const view = await upsertCommissionOverride(parsedId.data, parsed.data, actor);
    revalidateSeller(parsedId.data);
    revalidatePath("/admin/commissions");
    return ok(view, `Commission override saved at ${parsed.data.rateBps / 100}%.`);
  });
}

export async function deleteCommissionOverrideAction(sellerId: string): Promise<ActionResult<SellerCommissionView>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("commissions.manage");
    const view = await deleteCommissionOverride(sellerId, actor);
    revalidateSeller(sellerId);
    revalidatePath("/admin/commissions");
    return ok(view, "Commission override removed - the seller now inherits the marketplace rate.");
  });
}
