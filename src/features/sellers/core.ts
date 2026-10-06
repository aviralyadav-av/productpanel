import type { Prisma, Seller } from "@prisma/client";

import { conflict, notFound, validationError } from "@/lib/api/errors";
import { writeAudit, type AuditActor } from "@/lib/audit";
import { db } from "@/lib/db";
import { SELLER_STATUS_META, canTransitionSeller, type SellerStatus } from "@/lib/enums";

import { readSettingString } from "@/features/finance/settings-reader";
import { emitEvent } from "@/features/notifications/service";
import { STOREFRONT_PATHS } from "@/features/storefront/links";

import { transitionLabel, transitionNeedsReason } from "@/features/sellers/schemas";

/**
 * Primitives shared by the seller sub-services (documents, bank accounts,
 * registration) and the main service. They live apart so those modules can
 * import them without a cycle through service.ts, which re-exports them all.
 *
 * No `server-only` / `next/*` imports (G3).
 */

export type Db = Prisma.TransactionClient;
export type SellerActor = AuditActor;

export async function inTransaction<T>(tx: Db | undefined, body: (tx: Db) => Promise<T>): Promise<T> {
  return tx ? body(tx) : db.$transaction(body);
}

export function actorIdOrNull(actor: SellerActor): string | null {
  return actor.id === "system" ? null : actor.id;
}

export async function requireSeller(tx: Db | typeof db, id: string): Promise<Seller> {
  const seller = await tx.seller.findUnique({ where: { id } });
  if (!seller || seller.deletedAt) throw notFound("Seller");
  return seller;
}

/** Storefront profile URL from the `storefront.base_url` setting. */
export async function sellerPublicUrl(tx: Db | undefined, slug: string): Promise<string> {
  const base = (await readSettingString(tx, "storefront.base_url")).replace(/\/+$/, "");
  return `${base}${STOREFRONT_PATHS.seller(slug)}`;
}

// ---------------------------------------------------------------------------
// Activation readiness (C5)
// ---------------------------------------------------------------------------

/** APPROVED → ACTIVE needs at least one VERIFIED document and a primary bank account. */
export async function activationReady(tx: Db | typeof db, sellerId: string): Promise<boolean> {
  const [verifiedDocs, primaryBank] = await Promise.all([
    tx.sellerDocument.count({ where: { sellerId, status: "VERIFIED" } }),
    tx.sellerBankAccount.count({ where: { sellerId, isPrimary: true } }),
  ]);
  return verifiedDocs > 0 && primaryBank > 0;
}

// ---------------------------------------------------------------------------
// Counters (C7)
// ---------------------------------------------------------------------------

/**
 * Rebuild the denormalised counters from their sources. The finance service
 * increments `orderItemCount` / `grossSalesPaise` as ledger rows land and the
 * products service maintains the product counts; this is the reconciliation
 * path used after status changes and by the check script.
 */
export async function recomputeSellerCounters(tx: Db, sellerId: string): Promise<{
  productCount: number;
  publishedProductCount: number;
  orderItemCount: number;
  grossSalesPaise: number;
}> {
  const [productCount, publishedProductCount, sales] = await Promise.all([
    tx.product.count({ where: { sellerId, deletedAt: null } }),
    tx.product.count({ where: { sellerId, deletedAt: null, status: "PUBLISHED" } }),
    tx.sellerLedgerEntry.aggregate({
      where: { sellerId, type: "SALE" },
      _count: { _all: true },
      _sum: { amountPaise: true },
    }),
  ]);
  const counters = {
    productCount,
    publishedProductCount,
    orderItemCount: sales._count._all,
    grossSalesPaise: sales._sum.amountPaise ?? 0,
  };
  await tx.seller.update({ where: { id: sellerId }, data: counters });
  return counters;
}

// ---------------------------------------------------------------------------
// One hop of the state machine (C5)
// ---------------------------------------------------------------------------

/** Statuses where the seller's products are public - a change invalidates the catalog cache (§11.13). */
const PUBLIC_VISIBILITY_STATUSES: readonly SellerStatus[] = ["ACTIVE"];

export function affectsPublicCatalog(from: SellerStatus, to: SellerStatus): boolean {
  return PUBLIC_VISIBILITY_STATUSES.includes(from) !== PUBLIC_VISIBILITY_STATUSES.includes(to);
}

export type ApplyTransitionInput = {
  toStatus: SellerStatus;
  actor: SellerActor;
  reason?: string | null;
  /** Overrides the generated SellerEvent message (auto-activation). */
  message?: string;
};

/** Column changes each target status implies. */
function statusColumns(to: SellerStatus, actor: SellerActor, reason: string | null, now: Date): Prisma.SellerUpdateInput {
  const actorId = actorIdOrNull(actor);
  switch (to) {
    case "UNDER_REVIEW":
      return { rejectedAt: null, rejectionReason: null };
    case "APPROVED":
      return {
        approvedAt: now,
        approvedBy: actorId ? { connect: { id: actorId } } : undefined,
        rejectedAt: null,
        rejectionReason: null,
      };
    case "ACTIVE":
      return { suspendedAt: null, suspensionReason: null, lastActiveAt: now };
    case "SUSPENDED":
      return { suspendedAt: now, suspensionReason: reason };
    case "REJECTED":
      return { rejectedAt: now, rejectionReason: reason };
    default:
      return {};
  }
}

/**
 * Update + SellerEvent + audit + E3 email inside the caller's transaction.
 * Throws 409 for an illegal edge and 422 when a reason-bearing edge arrives
 * without one.
 */
export async function applyTransition(tx: Db, seller: Seller, input: ApplyTransitionInput): Promise<Seller> {
  const from = seller.status as SellerStatus;
  const to = input.toStatus;
  const reason = input.reason?.trim() || null;

  if (!canTransitionSeller(from, to)) {
    throw conflict(
      `A ${SELLER_STATUS_META[from]?.label.toLowerCase() ?? from} seller cannot be moved to ${
        SELLER_STATUS_META[to]?.label.toLowerCase() ?? to
      }.`,
    );
  }
  if (transitionNeedsReason(to) && !reason) {
    throw validationError({ reason: "A reason is required for this change." });
  }

  const now = new Date();
  const updated = await tx.seller.update({
    where: { id: seller.id },
    data: { status: to, ...statusColumns(to, input.actor, reason, now) },
  });

  const verb = transitionLabel(from, to);
  await tx.sellerEvent.create({
    data: {
      sellerId: seller.id,
      fromStatus: from,
      toStatus: to,
      message: input.message ?? `${verb}${reason ? `: ${reason}` : ""}`,
      actorId: actorIdOrNull(input.actor),
    },
  });

  await writeAudit(tx, {
    actor: input.actor,
    action: "seller.status_change",
    entityType: "Seller",
    entityId: seller.id,
    entityLabel: seller.displayName,
    summary: `${verb}: "${seller.displayName}" ${from} → ${to}${reason ? ` (${reason})` : ""}.`,
    diff: { status: { from, to }, ...(reason ? { reason } : {}) },
  });

  if (to === "APPROVED") {
    await emitEvent(
      "seller.approved",
      {
        sellerId: seller.id,
        sellerName: seller.displayName,
        sellerEmail: seller.email,
        sellerUrl: await sellerPublicUrl(tx, seller.slug),
      },
      tx,
    );
  } else if (to === "REJECTED") {
    await emitEvent(
      "seller.rejected",
      { sellerId: seller.id, sellerName: seller.displayName, sellerEmail: seller.email, reason: reason ?? "" },
      tx,
    );
  }

  return updated;
}

/**
 * APPROVED → ACTIVE without an operator click, once a document is VERIFIED
 * and a primary bank account exists (C5). Called by the document and bank
 * services after their own writes; a no-op in any other status. Returns true
 * when the seller was activated - the caller then invalidates the public cache.
 */
export async function maybeAutoActivate(tx: Db, sellerId: string, actor: SellerActor): Promise<boolean> {
  const seller = await tx.seller.findUnique({ where: { id: sellerId } });
  if (!seller || seller.deletedAt || seller.status !== "APPROVED") return false;
  if (!(await activationReady(tx, sellerId))) return false;
  await applyTransition(tx, seller, {
    toStatus: "ACTIVE",
    actor,
    message: "Activated automatically: verified KYC document and primary bank account on file.",
  });
  await recomputeSellerCounters(tx, sellerId);
  return true;
}
