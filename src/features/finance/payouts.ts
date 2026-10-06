import type { Prisma, SellerPayout } from "@prisma/client";

import {
  OPEN_PAYOUT_STATUSES,
  canTransitionPayout,
  payoutStatusSchema,
  type PayoutStatus,
} from "@/lib/enums";
import { nextNumber } from "./numbering";
import { FinanceError, recomputeSellerBalance } from "./service";
import { readSettingNumber } from "./settings-reader";

/**
 * Payout statements (blueprint §14.B5).
 *
 * A statement is a SNAPSHOT of AVAILABLE ledger rows moved to SCHEDULED under
 * one payoutId. Its columns are positive magnitudes recomputed from those rows,
 * and `netPaise` MUST equal their signed sum - the assertion at the end of
 * `generatePayout` is what stops a formula change from ever producing a
 * statement that pays a seller a different amount than the ledger says.
 */

type Db = Prisma.TransactionClient;
type ActorLike = { id: string };

export type GeneratePayoutInput = {
  sellerId: string;
  /** Include rows available on or before this instant. */
  periodTo: Date;
  actorId?: string | null;
  method?: "BANK_TRANSFER" | "UPI" | "MANUAL";
  bankAccountId?: string | null;
  notes?: string | null;
};

export type GeneratePayoutResult =
  | { held: false; payout: SellerPayout; entryCount: number }
  | { held: true; netPaise: number; minPayoutPaise: number; entryCount: number };

type Totals = {
  grossSalesPaise: number;
  commissionPaise: number;
  chargesPaise: number;
  refundsPaise: number;
  adjustmentsPaise: number;
  netPaise: number;
  signedSum: number;
};

function totalsOf(rows: ReadonlyArray<{ type: string; amountPaise: number }>): Totals {
  const sum = (predicate: (row: { type: string; amountPaise: number }) => boolean) =>
    rows.filter(predicate).reduce((total, row) => total + row.amountPaise, 0);

  const grossSalesPaise = sum((row) => row.type === "SALE");
  const commissionPaise = -sum((row) => row.type === "COMMISSION" || row.type === "COMMISSION_TAX");
  const chargesPaise = -sum((row) => row.type === "CHARGE");
  const refundsPaise = -sum((row) => row.type === "REFUND_REVERSAL");
  const adjustmentsPaise = sum((row) => row.type === "ADJUSTMENT");
  const signedSum = sum(() => true);

  return {
    grossSalesPaise,
    commissionPaise,
    chargesPaise,
    refundsPaise,
    adjustmentsPaise,
    netPaise: grossSalesPaise - commissionPaise - chargesPaise - refundsPaise + adjustmentsPaise,
    signedSum,
  };
}

/**
 * Create a statement for everything AVAILABLE up to `periodTo`. Returns
 * `{ held: true }` - and writes nothing - when the net is at or below the
 * minimum payout (including ≤ 0 after refunds), so the rows stay AVAILABLE and
 * carry forward into the next run. There is no HELD status by design.
 */
export async function generatePayout(tx: Db, input: GeneratePayoutInput): Promise<GeneratePayoutResult> {
  const seller = await tx.seller.findUnique({
    where: { id: input.sellerId },
    select: { id: true, deletedAt: true },
  });
  if (!seller || seller.deletedAt) {
    throw new FinanceError("NOT_FOUND", "Seller not found.", { sellerId: input.sellerId });
  }

  // Pre-checked (the partial unique index would abort the transaction).
  const open = await tx.sellerPayout.findFirst({
    where: { sellerId: input.sellerId, status: { in: [...OPEN_PAYOUT_STATUSES] } },
    select: { id: true, payoutNumber: true, status: true },
  });
  if (open) {
    throw new FinanceError("PAYOUT_OPEN", `Statement ${open.payoutNumber} is still ${open.status.toLowerCase()}.`, {
      payoutId: open.id,
    });
  }

  const eligibleWhere: Prisma.SellerLedgerEntryWhereInput = {
    sellerId: input.sellerId,
    status: "AVAILABLE",
    payoutId: null,
    OR: [{ availableAt: null }, { availableAt: { lte: input.periodTo } }],
  };

  const preview = await tx.sellerLedgerEntry.findMany({
    where: eligibleWhere,
    select: { type: true, amountPaise: true, createdAt: true },
  });
  const minPayoutPaise = await readSettingNumber(tx, "marketplace.min_payout_paise");
  const previewTotals = totalsOf(preview);

  if (preview.length === 0 || previewTotals.netPaise <= minPayoutPaise) {
    return { held: true, netPaise: previewTotals.netPaise, minPayoutPaise, entryCount: preview.length };
  }

  const bankAccount =
    input.bankAccountId ??
    (
      await tx.sellerBankAccount.findFirst({
        where: { sellerId: input.sellerId, isPrimary: true },
        select: { id: true },
      })
    )?.id ??
    null;

  const { seq, number } = await nextNumber(tx, "SellerPayout");
  const lastPaid = await tx.sellerPayout.findFirst({
    where: { sellerId: input.sellerId, status: "PAID" },
    orderBy: { periodTo: "desc" },
    select: { periodTo: true },
  });
  const periodFrom =
    lastPaid?.periodTo ??
    preview.reduce((earliest, row) => (row.createdAt < earliest ? row.createdAt : earliest), preview[0].createdAt);

  const payout = await tx.sellerPayout.create({
    data: {
      seq,
      payoutNumber: number,
      sellerId: input.sellerId,
      periodFrom,
      periodTo: input.periodTo,
      status: "PENDING",
      method: input.method ?? "BANK_TRANSFER",
      bankAccountId: bankAccount,
      notes: input.notes ?? null,
      createdById: input.actorId ?? null,
    },
  });

  await tx.sellerLedgerEntry.updateMany({
    where: eligibleWhere,
    data: { status: "SCHEDULED", payoutId: payout.id },
  });

  // Read back what was actually scheduled - never trust the preview.
  const scheduled = await tx.sellerLedgerEntry.findMany({
    where: { payoutId: payout.id },
    select: { type: true, amountPaise: true },
  });
  const totals = totalsOf(scheduled);
  if (totals.netPaise !== totals.signedSum) {
    throw new FinanceError("TOTALS_MISMATCH", "Statement totals do not reconcile with the ledger.", {
      payoutId: payout.id,
      ...totals,
    });
  }

  const updated = await tx.sellerPayout.update({
    where: { id: payout.id },
    data: {
      grossSalesPaise: totals.grossSalesPaise,
      commissionPaise: totals.commissionPaise,
      chargesPaise: totals.chargesPaise,
      refundsPaise: totals.refundsPaise,
      adjustmentsPaise: totals.adjustmentsPaise,
      netPaise: totals.netPaise,
    },
  });

  await recomputeSellerBalance(tx, input.sellerId);
  return { held: false, payout: updated, entryCount: scheduled.length };
}

export type TransitionPayoutInput = {
  payoutId: string;
  toStatus: PayoutStatus;
  actor: ActorLike;
  referenceNumber?: string | null;
  failureReason?: string | null;
  /** Override the account to pay at PROCESSING. */
  bankAccountId?: string | null;
  notes?: string | null;
};

/**
 * PENDING→APPROVED|CANCELLED; APPROVED→PROCESSING|CANCELLED; PROCESSING→PAID|FAILED.
 * PROCESSING snapshots the (masked) bank account so the statement records
 * where the money went even if the seller later changes accounts. PAID moves
 * the rows to PAID and appends the single PAYOUT row (−net). FAILED/CANCELLED
 * hand the rows back to AVAILABLE for the next statement.
 */
export async function transitionPayout(tx: Db, input: TransitionPayoutInput): Promise<SellerPayout> {
  const toStatus = payoutStatusSchema.parse(input.toStatus);
  const payout = await tx.sellerPayout.findUnique({ where: { id: input.payoutId } });
  if (!payout) throw new FinanceError("NOT_FOUND", "Payout not found.", { payoutId: input.payoutId });

  const fromStatus = payoutStatusSchema.parse(payout.status);
  if (!canTransitionPayout(fromStatus, toStatus)) {
    throw new FinanceError("INVALID_STATE", `A ${fromStatus.toLowerCase()} statement cannot become ${toStatus.toLowerCase()}.`, {
      fromStatus,
      toStatus,
    });
  }

  const now = new Date();
  const data: Prisma.SellerPayoutUpdateInput = { status: toStatus };
  if (input.notes !== undefined) data.notes = input.notes;

  switch (toStatus) {
    case "APPROVED":
      data.approvedBy = { connect: { id: input.actor.id } };
      data.approvedAt = now;
      break;

    case "PROCESSING": {
      const accountId = input.bankAccountId ?? payout.bankAccountId;
      const account = accountId
        ? await tx.sellerBankAccount.findFirst({
            where: { id: accountId, sellerId: payout.sellerId },
            select: {
              id: true,
              accountHolder: true,
              bankName: true,
              accountNumberLast4: true,
              ifsc: true,
              upiId: true,
              isVerified: true,
            },
          })
        : null;
      if (!account && payout.method !== "MANUAL") {
        throw new FinanceError("BANK_ACCOUNT_REQUIRED", "Choose a bank account before processing this payout.");
      }
      if (account) {
        data.bankAccount = { connect: { id: account.id } };
        // Masked on purpose: the statement is read by people who may not hold
        // payouts.process, and the full number lives encrypted on the account.
        data.bankAccountSnapshot = {
          accountHolder: account.accountHolder,
          bankName: account.bankName,
          accountNumberLast4: account.accountNumberLast4,
          ifsc: account.ifsc,
          upiId: account.upiId,
          isVerified: account.isVerified,
          snapshotAt: now.toISOString(),
        };
      }
      data.processedAt = now;
      break;
    }

    case "PAID": {
      data.paidAt = now;
      data.referenceNumber = input.referenceNumber ?? payout.referenceNumber;
      await tx.sellerLedgerEntry.updateMany({
        where: { payoutId: payout.id, status: "SCHEDULED" },
        data: { status: "PAID" },
      });
      await tx.sellerLedgerEntry.create({
        data: {
          sellerId: payout.sellerId,
          payoutId: payout.id,
          type: "PAYOUT",
          amountPaise: -payout.netPaise,
          description: `Payout ${payout.payoutNumber}${input.referenceNumber ? ` · ref ${input.referenceNumber}` : ""}`,
          status: "PAID",
          availableAt: now,
        },
      });
      break;
    }

    case "FAILED":
    case "CANCELLED":
      data.failureReason = input.failureReason ?? payout.failureReason ?? (toStatus === "CANCELLED" ? "Cancelled" : null);
      await tx.sellerLedgerEntry.updateMany({
        where: { payoutId: payout.id, status: "SCHEDULED" },
        data: { status: "AVAILABLE", payoutId: null },
      });
      break;
  }

  const updated = await tx.sellerPayout.update({ where: { id: payout.id }, data });
  await recomputeSellerBalance(tx, payout.sellerId);
  return updated;
}
