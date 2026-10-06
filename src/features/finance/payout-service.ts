import type { SellerPayout } from "@prisma/client";

import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { db } from "@/lib/db";
import { PAYOUT_STATUS_META, canTransitionPayout, type PayoutStatus } from "@/lib/enums";
import { formatPaise } from "@/lib/money";
import { emitEvent } from "@/features/notifications/service";

import { FinanceError, generatePayout, markEarningsAvailable, transitionPayout } from "./service";
import type { GeneratePayoutFormValues, PayoutTransitionValues } from "./ui-schemas";

/**
 * Orchestration around the frozen payout domain functions in `payouts.ts`
 * (blueprint §10 payout flow, §14.B5).
 *
 * `generatePayout` / `transitionPayout` are transaction-scoped and audit
 * nothing on purpose - they are called from the order pipeline as well as from
 * the admin screen. This module is the ADMIN entry point: it opens the
 * transaction, records the D13-mandated audit row for approve / process /
 * paid / fail inside it (so a failed audit rolls the money movement back), and
 * fires the "ready for approval" notification after the commit.
 *
 * No `server-only` / `next/*` imports - the check script drives these too.
 */

type ClientMeta = { ip?: string | null };

export type GenerateStatementResult =
  | {
      held: true;
      sellerId: string;
      sellerName: string;
      netPaise: number;
      minPayoutPaise: number;
      entryCount: number;
    }
  | {
      held: false;
      sellerId: string;
      sellerName: string;
      payoutId: string;
      payoutNumber: string;
      netPaise: number;
      entryCount: number;
    };

/** Audit action per target status; these are the four D13 mandates plus cancel. */
const TRANSITION_ACTION: Record<PayoutStatus, string> = {
  PENDING: "payout.reopen",
  APPROVED: "payout.approve",
  PROCESSING: "payout.process",
  PAID: "payout.paid",
  FAILED: "payout.fail",
  CANCELLED: "payout.cancel",
};

/**
 * `FinanceError` is a domain error with no HTTP opinion. The admin surfaces
 * need a status and a sentence a form can show, so each code is mapped once
 * here rather than being re-guessed in every action and route handler.
 */
export function financeApiError(error: unknown): never {
  if (error instanceof FinanceError) {
    switch (error.code) {
      case "NOT_FOUND":
        throw notFound("Payout");
      case "PAYOUT_OPEN":
        throw conflict(`${error.message} Finish or cancel it before generating another.`);
      case "BANK_ACCOUNT_REQUIRED":
        throw badRequest(error.message, { bankAccountId: "Choose an account." });
      case "TOTALS_MISMATCH":
        throw conflict(
          `${error.message} Nothing was saved - recompute the seller's balance and try again.`,
        );
      default:
        throw conflict(error.message);
    }
  }
  throw error;
}

/** Run a domain call, translating FinanceError into an ApiError. */
async function financed<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    return financeApiError(error);
  }
}

function payoutDiffShape(payout: SellerPayout): Record<string, unknown> {
  return {
    status: payout.status,
    netPaise: payout.netPaise,
    grossSalesPaise: payout.grossSalesPaise,
    commissionPaise: payout.commissionPaise,
    chargesPaise: payout.chargesPaise,
    refundsPaise: payout.refundsPaise,
    adjustmentsPaise: payout.adjustmentsPaise,
    method: payout.method,
    bankAccountId: payout.bankAccountId,
    referenceNumber: payout.referenceNumber,
    failureReason: payout.failureReason,
    notes: payout.notes,
  };
}

export async function generateStatement(
  input: GeneratePayoutFormValues,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<GenerateStatementResult> {
  const periodTo = input.periodTo ?? new Date();

  const result = await db.$transaction(async (tx) => {
    const seller = await tx.seller.findFirst({
      where: { id: input.sellerId, deletedAt: null },
      select: { id: true, displayName: true },
    });
    if (!seller) throw notFound("Seller");

    const generated = await financed(() =>
      generatePayout(tx, {
        sellerId: seller.id,
        periodTo,
        actorId: actor.id,
        method: input.method,
        bankAccountId: input.bankAccountId,
        notes: input.notes,
      }),
    );

    if (generated.held) {
      // Nothing was written, so nothing is audited: "we looked and there was
      // not enough" is not a change to the ledger.
      return {
        held: true as const,
        sellerId: seller.id,
        sellerName: seller.displayName,
        netPaise: generated.netPaise,
        minPayoutPaise: generated.minPayoutPaise,
        entryCount: generated.entryCount,
      };
    }

    await writeAudit(tx, {
      actor,
      action: "payout.generate",
      entityType: "SellerPayout",
      entityId: generated.payout.id,
      entityLabel: generated.payout.payoutNumber,
      summary: `Generated ${generated.payout.payoutNumber} for ${seller.displayName} (${formatPaise(generated.payout.netPaise)}, ${generated.entryCount} entries)`,
      diff: diffOf(null, payoutDiffShape(generated.payout)),
      ip: meta.ip,
    });

    return {
      held: false as const,
      sellerId: seller.id,
      sellerName: seller.displayName,
      payoutId: generated.payout.id,
      payoutNumber: generated.payout.payoutNumber,
      netPaise: generated.payout.netPaise,
      entryCount: generated.entryCount,
    };
  });

  if (!result.held) {
    // After the commit: a notification is not worth failing a payout for.
    await emitEvent("payout.generated", {
      payoutId: result.payoutId,
      payoutNumber: result.payoutNumber,
      sellerId: result.sellerId,
      sellerName: result.sellerName,
      netText: formatPaise(result.netPaise),
    });
  }

  return result;
}

export type TransitionStatementResult = {
  payoutId: string;
  payoutNumber: string;
  sellerId: string;
  sellerName: string;
  fromStatus: PayoutStatus;
  toStatus: PayoutStatus;
  netPaise: number;
  /** How many ledger rows were handed back to AVAILABLE (FAILED/CANCELLED). */
  releasedEntries: number;
};

export async function transitionStatement(
  payoutId: string,
  input: PayoutTransitionValues,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<TransitionStatementResult> {
  return db.$transaction(async (tx) => {
    const before = await tx.sellerPayout.findUnique({
      where: { id: payoutId },
      select: {
        id: true,
        payoutNumber: true,
        status: true,
        netPaise: true,
        grossSalesPaise: true,
        commissionPaise: true,
        chargesPaise: true,
        refundsPaise: true,
        adjustmentsPaise: true,
        method: true,
        bankAccountId: true,
        referenceNumber: true,
        failureReason: true,
        notes: true,
        seller: { select: { id: true, displayName: true } },
      },
    });
    if (!before) throw notFound("Payout");

    const fromStatus = before.status as PayoutStatus;
    if (!canTransitionPayout(fromStatus, input.toStatus)) {
      throw conflict(
        `A ${PAYOUT_STATUS_META[fromStatus].label.toLowerCase()} statement cannot become ${PAYOUT_STATUS_META[input.toStatus].label.toLowerCase()}.`,
      );
    }

    const releasing = input.toStatus === "FAILED" || input.toStatus === "CANCELLED";
    const releasedEntries = releasing
      ? await tx.sellerLedgerEntry.count({ where: { payoutId, status: "SCHEDULED" } })
      : 0;

    const payout = await financed(() =>
      transitionPayout(tx, {
        payoutId,
        toStatus: input.toStatus,
        actor: { id: actor.id },
        referenceNumber: input.referenceNumber,
        failureReason: input.failureReason,
        bankAccountId: input.bankAccountId,
        notes: input.notes ?? undefined,
      }),
    );

    await writeAudit(tx, {
      actor,
      action: TRANSITION_ACTION[input.toStatus],
      entityType: "SellerPayout",
      entityId: payout.id,
      entityLabel: payout.payoutNumber,
      summary: `${payout.payoutNumber} · ${PAYOUT_STATUS_META[fromStatus].label} → ${PAYOUT_STATUS_META[input.toStatus].label} (${formatPaise(payout.netPaise)} to ${before.seller.displayName})`,
      diff: diffOf(
        { ...before, seller: undefined, id: undefined, payoutNumber: undefined },
        payoutDiffShape(payout),
      ),
      ip: meta.ip,
    });

    return {
      payoutId: payout.id,
      payoutNumber: payout.payoutNumber,
      sellerId: before.seller.id,
      sellerName: before.seller.displayName,
      fromStatus,
      toStatus: input.toStatus,
      netPaise: payout.netPaise,
      releasedEntries,
    };
  });
}

/**
 * The `earnings.mark_available` job, run on demand from the payouts screen.
 * Audited even though it touches no money directly, because it decides which
 * earnings the next statement may pick up (D13 "payout" family).
 */
export async function runMarkEarningsAvailable(
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<{ updated: number; sellers: number }> {
  const result = await markEarningsAvailable();

  if (result.updated > 0) {
    await writeAudit({
      actor,
      action: "payout.mark_available",
      entityType: "SellerLedgerEntry",
      entityId: null,
      entityLabel: "Hold expiry",
      summary: `Released ${result.updated} ledger entr${result.updated === 1 ? "y" : "ies"} for ${result.sellerIds.length} seller${result.sellerIds.length === 1 ? "" : "s"}`,
      diff: { updated: result.updated, sellerIds: result.sellerIds },
      ip: meta.ip,
    });
  }

  return { updated: result.updated, sellers: result.sellerIds.length };
}

export { FinanceError };
