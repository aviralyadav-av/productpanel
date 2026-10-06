import { notFound } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { db } from "@/lib/db";

import { recomputeSellerBalance } from "./service";
import type { AdjustmentValues } from "./ui-schemas";

/**
 * Manual ledger writes (blueprint §14.B5, D14 `payouts.adjust`).
 *
 * The ledger is append-only, so "correcting" a seller's balance means adding a
 * signed ADJUSTMENT row and letting the projection follow - never editing a
 * SALE or COMMISSION row. The entry lands as AVAILABLE with `availableAt` now,
 * which is what makes it pick-up-able by the very next statement; a negative
 * adjustment therefore reduces the next payout rather than clawing back money
 * already paid.
 *
 * No `server-only` / `next/*` imports: the check script writes adjustments too.
 */

type ClientMeta = { ip?: string | null };

export type SellerBalanceView = {
  pendingPaise: number;
  availablePaise: number;
  scheduledPaise: number;
  paidPaise: number;
};

export type AdjustmentResult = {
  entryId: string;
  sellerId: string;
  sellerName: string;
  amountPaise: number;
  balance: SellerBalanceView;
};

export async function recordLedgerAdjustment(
  input: AdjustmentValues,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<AdjustmentResult> {
  return db.$transaction(async (tx) => {
    const seller = await tx.seller.findFirst({
      where: { id: input.sellerId, deletedAt: null },
      select: { id: true, displayName: true },
    });
    if (!seller) throw notFound("Seller");

    const now = new Date();
    const entry = await tx.sellerLedgerEntry.create({
      data: {
        sellerId: seller.id,
        type: "ADJUSTMENT",
        amountPaise: input.amountPaise,
        description: input.description,
        status: "AVAILABLE",
        availableAt: now,
      },
    });

    const balance = await recomputeSellerBalance(tx, seller.id);

    // D13 lists ledger adjustments among the money events that must be
    // traceable; the audit row carries the signed amount and the reason the
    // operator typed, which together are the only record of WHY.
    await writeAudit(tx, {
      actor,
      action: "payout.adjustment",
      entityType: "SellerLedgerEntry",
      entityId: entry.id,
      entityLabel: seller.displayName,
      summary: `${input.amountPaise >= 0 ? "Credited" : "Debited"} ${seller.displayName} by manual adjustment`,
      diff: diffOf(null, {
        sellerId: seller.id,
        amountPaise: input.amountPaise,
        description: input.description,
        status: "AVAILABLE",
      }),
      ip: meta.ip,
    });

    return {
      entryId: entry.id,
      sellerId: seller.id,
      sellerName: seller.displayName,
      amountPaise: input.amountPaise,
      balance,
    };
  });
}

/**
 * Rebuilds `SellerBalance` from the ledger rows. The ledger is the source of
 * truth and the balance is a projection, so this is the repair for any drift -
 * and it is audited because a balance that suddenly moves without an order or
 * a payout behind it needs an explanation.
 */
export async function recomputeBalanceForSeller(
  sellerId: string,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<{ sellerId: string; sellerName: string; before: SellerBalanceView | null; after: SellerBalanceView }> {
  return db.$transaction(async (tx) => {
    const seller = await tx.seller.findFirst({
      where: { id: sellerId, deletedAt: null },
      select: { id: true, displayName: true },
    });
    if (!seller) throw notFound("Seller");

    const previous = await tx.sellerBalance.findUnique({
      where: { sellerId },
      select: { pendingPaise: true, availablePaise: true, scheduledPaise: true, paidPaise: true },
    });
    const after = await recomputeSellerBalance(tx, sellerId);

    const diff = diffOf(previous, after);
    if (diff) {
      await writeAudit(tx, {
        actor,
        action: "payout.balance_recompute",
        entityType: "SellerBalance",
        entityId: seller.id,
        entityLabel: seller.displayName,
        summary: `Recomputed ${seller.displayName}'s balance from the ledger`,
        diff,
        ip: meta.ip,
      });
    }

    return { sellerId: seller.id, sellerName: seller.displayName, before: previous, after };
  });
}
