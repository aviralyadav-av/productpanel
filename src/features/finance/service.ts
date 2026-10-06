import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import {
  COUNTED_REFUND_STATUSES,
  OPEN_RETURN_STATUSES,
  commissionTargetKey,
  marketplaceChargeSchema,
  type CommissionScope,
  type LedgerEntryStatus,
} from "@/lib/enums";
import {
  computeCommission,
  proRata,
  type ChargeRule,
} from "./math";
import { readSettingJson, readSettingNumber } from "./settings-reader";

export { formatNumber, nextNumber, type NumberedModel } from "./numbering";
export {
  generatePayout,
  transitionPayout,
  type GeneratePayoutInput,
  type GeneratePayoutResult,
  type TransitionPayoutInput,
} from "./payouts";

/**
 * Commission resolution and the seller ledger (blueprint §10, §14.B3-B4).
 *
 * The ledger is APPEND-ONLY. A SALE or COMMISSION row is never edited: a
 * refund appends REFUND_REVERSAL rows, a payout moves rows between statuses,
 * and `SellerBalance` is recomputed from the rows in the same transaction as
 * every write. If the balance ever disagrees with the ledger, the ledger is
 * right - `recomputeSellerBalance()` is the repair.
 *
 * Everything here takes a transaction client because earnings are recorded
 * as a side effect of a shipment being delivered, a refund completing or a
 * payout being paid, and those must commit or roll back with the row that
 * caused them.
 */

type Db = Prisma.TransactionClient;

export class FinanceError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "INVALID_STATE"
      | "PAYOUT_OPEN"
      | "TOTALS_MISMATCH"
      | "BANK_ACCOUNT_REQUIRED",
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "FinanceError";
  }
}

// ---------------------------------------------------------------------------
// Commission resolution (B3)
// ---------------------------------------------------------------------------

export type ResolvedCommission = {
  rateBps: number;
  fixedPaise: number;
  ruleId: string | null;
  scope: CommissionScope;
};

type RuleRow = {
  id: string;
  scope: string;
  targetKey: string;
  categoryId: string | null;
  rateBps: number;
  fixedPaise: number;
};

function ruleInWindow(rule: { startsAt: Date | null; endsAt: Date | null }, now: Date): boolean {
  if (rule.startsAt && rule.startsAt > now) return false;
  if (rule.endsAt && rule.endsAt < now) return false;
  return true;
}

/**
 * PRODUCT → SELLER → nearest CATEGORY ancestor → GLOBAL. A seller-wide rule
 * beats a category rule on purpose: a negotiated seller rate is a contract, a
 * category rate is a default. Called in the order transaction and SNAPSHOTTED
 * onto OrderItem; the ledger never re-resolves.
 */
export async function resolveCommission(
  tx: Db | undefined,
  input: {
    productId?: string | null;
    sellerId?: string | null;
    categoryId?: string | null;
    /** Category.path (slug-based); saves a lookup when the caller has it. */
    categoryPath?: string | null;
    now?: Date;
  },
): Promise<ResolvedCommission> {
  const client = tx ?? db;
  const now = input.now ?? new Date();

  const rules = (
    await client.commissionRule.findMany({
      where: { isActive: true },
      select: {
        id: true,
        scope: true,
        targetKey: true,
        categoryId: true,
        rateBps: true,
        fixedPaise: true,
        startsAt: true,
        endsAt: true,
      },
    })
  ).filter((rule) => ruleInWindow(rule, now));
  const byKey = new Map<string, RuleRow>(rules.map((rule) => [rule.targetKey, rule]));

  const pick = (rule: RuleRow | undefined): ResolvedCommission | null =>
    rule
      ? {
          rateBps: rule.rateBps,
          fixedPaise: rule.fixedPaise,
          ruleId: rule.id,
          scope: rule.scope as CommissionScope,
        }
      : null;

  if (input.productId) {
    const hit = pick(byKey.get(commissionTargetKey("PRODUCT", input.productId)));
    if (hit) return hit;
  }
  if (input.sellerId) {
    const hit = pick(byKey.get(commissionTargetKey("SELLER", input.sellerId)));
    if (hit) return hit;
  }

  const categoryRules = rules.filter((rule) => rule.scope === "CATEGORY" && rule.categoryId);
  if (categoryRules.length > 0 && (input.categoryId || input.categoryPath)) {
    const ancestors = await categoryAncestorIds(client, {
      categoryId: input.categoryId ?? null,
      categoryPath: input.categoryPath ?? null,
    });
    // ancestors is root → leaf; the nearest ancestor is the last match.
    for (let index = ancestors.length - 1; index >= 0; index -= 1) {
      const hit = pick(byKey.get(commissionTargetKey("CATEGORY", ancestors[index])));
      if (hit) return hit;
    }
  }

  const global = pick(byKey.get(commissionTargetKey("GLOBAL")));
  return global ?? { rateBps: 0, fixedPaise: 0, ruleId: null, scope: "GLOBAL" };
}

/** Category ids from root to the given category, derived from the slug path. */
export async function categoryAncestorIds(
  tx: Db | typeof db,
  input: { categoryId: string | null; categoryPath: string | null },
): Promise<string[]> {
  let path = input.categoryPath;
  if (!path && input.categoryId) {
    const category = await tx.category.findUnique({
      where: { id: input.categoryId },
      select: { path: true },
    });
    path = category?.path ?? null;
  }
  if (!path) return input.categoryId ? [input.categoryId] : [];

  // "/home-living/candles" → ["/home-living", "/home-living/candles"]
  const segments = path.split("/").filter(Boolean);
  const prefixes = segments.map((_segment, index) => `/${segments.slice(0, index + 1).join("/")}`);
  const rows = await tx.category.findMany({
    where: { path: { in: prefixes } },
    select: { id: true, depth: true },
    orderBy: { depth: "asc" },
  });
  return rows.map((row) => row.id);
}

/** The `marketplace.charges` setting, validated; malformed entries are dropped, not fatal. */
export async function loadChargeRules(tx?: Db): Promise<ChargeRule[]> {
  const raw = await readSettingJson<unknown>(tx, "marketplace.charges", []);
  if (!Array.isArray(raw)) return [];
  const rules: ChargeRule[] = [];
  for (const entry of raw) {
    const parsed = marketplaceChargeSchema.safeParse(entry);
    if (parsed.success) rules.push(parsed.data);
  }
  return rules;
}

// ---------------------------------------------------------------------------
// Balance projection (B4)
// ---------------------------------------------------------------------------

export async function recomputeSellerBalance(tx: Db, sellerId: string): Promise<{
  pendingPaise: number;
  availablePaise: number;
  scheduledPaise: number;
  paidPaise: number;
}> {
  const [byStatus, payouts] = await Promise.all([
    tx.sellerLedgerEntry.groupBy({
      by: ["status"],
      where: { sellerId },
      _sum: { amountPaise: true },
    }),
    tx.sellerLedgerEntry.aggregate({
      where: { sellerId, type: "PAYOUT" },
      _sum: { amountPaise: true },
    }),
  ]);

  const sumFor = (status: LedgerEntryStatus) =>
    byStatus.find((row) => row.status === status)?._sum.amountPaise ?? 0;

  const balance = {
    pendingPaise: sumFor("PENDING"),
    availablePaise: sumFor("AVAILABLE"),
    scheduledPaise: sumFor("SCHEDULED"),
    // Money that actually left the platform: the PAYOUT rows are negative.
    paidPaise: -(payouts._sum.amountPaise ?? 0),
  };

  await tx.sellerBalance.upsert({
    where: { sellerId },
    create: { sellerId, ...balance },
    update: balance,
  });

  return balance;
}

// ---------------------------------------------------------------------------
// Earnings on delivery (B4)
// ---------------------------------------------------------------------------

export type RecordEarningsResult = {
  shipmentId: string;
  entriesCreated: number;
  itemsSkipped: number;
  sellerIds: string[];
  availableAt: Date | null;
};

const HOLD_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Called when a shipment is DELIVERED. Writes SALE / COMMISSION / CHARGE rows
 * for each delivered line that belongs to a seller, PENDING until the payout
 * hold has passed. Idempotent through the partial unique index
 * `SellerLedgerEntry_item_type_once`: lines that already have their rows are
 * skipped BEFORE the insert (a constraint error would abort the caller's
 * transaction in Postgres, so catching P2002 after the fact is not an option).
 */
export async function recordEarningsForDeliveredItems(
  tx: Db,
  shipmentId: string,
  actorId?: string | null,
): Promise<RecordEarningsResult> {
  // The ledger has no actor column by design (rows are facts, not actions);
  // the caller audits with the actor. Kept in the signature per §10.
  void actorId;

  const shipment = await tx.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      deliveredAt: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          paymentMethod: true,
          pricesIncludeTax: true,
          taxRemittedBy: true,
        },
      },
      items: {
        select: {
          quantity: true,
          orderItem: {
            select: {
              id: true,
              sellerId: true,
              titleSnapshot: true,
              variantSnapshot: true,
              unitPricePaise: true,
              customizationPaise: true,
              quantity: true,
              sellerFundedDiscountPaise: true,
              taxRateBps: true,
              commissionBps: true,
              commissionFixedPaise: true,
              commissionPaise: true,
              chargesPaise: true,
            },
          },
        },
      },
    },
  });
  if (!shipment) throw new FinanceError("NOT_FOUND", "Shipment not found.", { shipmentId });

  const items = shipment.items
    .map((row) => row.orderItem)
    .filter((item) => item.sellerId !== null);
  if (items.length === 0) {
    return { shipmentId, entriesCreated: 0, itemsSkipped: 0, sellerIds: [], availableAt: null };
  }

  const holdDays = await readSettingNumber(tx, "marketplace.payout_hold_days");
  const deliveredAt = shipment.deliveredAt ?? new Date();
  const availableAt = new Date(deliveredAt.getTime() + holdDays * HOLD_DAY_MS);

  const existing = await tx.sellerLedgerEntry.findMany({
    where: { orderItemId: { in: items.map((item) => item.id) }, type: "SALE" },
    select: { orderItemId: true },
  });
  const done = new Set(existing.map((row) => row.orderItemId));

  const rows: Prisma.SellerLedgerEntryCreateManyInput[] = [];
  const sellerIds = new Set<string>();
  const grossBySeller = new Map<string, { gross: number; items: number }>();
  let itemsSkipped = 0;

  for (const item of items) {
    if (done.has(item.id)) {
      itemsSkipped += 1;
      continue;
    }
    const sellerId = item.sellerId as string;
    const label = [shipment.order.orderNumber, item.titleSnapshot, item.variantSnapshot]
      .filter(Boolean)
      .join(" · ");

    // Snapshots only (B3): the rate that applied at placement, never today's.
    const money = computeCommission({
      lineGross: (item.unitPricePaise + item.customizationPaise) * item.quantity,
      sellerFundedDiscountPaise: item.sellerFundedDiscountPaise,
      taxRateBps: item.taxRateBps,
      pricesIncludeTax: shipment.order.pricesIncludeTax,
      taxRemittedBy: shipment.order.taxRemittedBy === "PLATFORM" ? "PLATFORM" : "SELLER",
      rateBps: item.commissionBps,
      fixedPaise: item.commissionFixedPaise,
      quantity: item.quantity,
      paymentMethod: shipment.order.paymentMethod,
    });

    const base = {
      sellerId,
      orderId: shipment.order.id,
      orderItemId: item.id,
      status: "PENDING",
      availableAt,
    };
    rows.push({ ...base, type: "SALE", amountPaise: money.sellerGross, description: `Sale · ${label}` });
    rows.push({
      ...base,
      type: "COMMISSION",
      amountPaise: -item.commissionPaise,
      description: `Commission · ${label}`,
    });
    if (item.chargesPaise > 0) {
      rows.push({
        ...base,
        type: "CHARGE",
        amountPaise: -item.chargesPaise,
        description: `Marketplace charges · ${label}`,
      });
    }

    sellerIds.add(sellerId);
    const counter = grossBySeller.get(sellerId) ?? { gross: 0, items: 0 };
    counter.gross += money.sellerGross;
    counter.items += 1;
    grossBySeller.set(sellerId, counter);
  }

  if (rows.length > 0) {
    await tx.sellerLedgerEntry.createMany({ data: rows });
  }

  for (const [sellerId, counter] of grossBySeller) {
    await tx.seller.update({
      where: { id: sellerId },
      data: {
        orderItemCount: { increment: counter.items },
        grossSalesPaise: { increment: counter.gross },
      },
    });
    await recomputeSellerBalance(tx, sellerId);
  }

  return {
    shipmentId,
    entriesCreated: rows.length,
    itemsSkipped,
    sellerIds: [...sellerIds],
    availableAt,
  };
}

// ---------------------------------------------------------------------------
// Refund reversal (B4)
// ---------------------------------------------------------------------------

export type ReverseEarningsResult = {
  refundId: string;
  entriesCreated: number;
  sellerIds: string[];
  alreadyReversed: boolean;
};

/**
 * On Refund COMPLETED. Per affected item: −proRata(sellerGross) and
 * +proRata(commission), status AVAILABLE, availableAt now - appended even when
 * the originals are still PENDING, because a refund is a fact regardless of
 * whether the earning was paid yet. Negative rows are sale reversals and
 * positive rows commission reversals; the refund number in the description is
 * the idempotency key (the ledger has no refundId column by design - rows are
 * facts, not links).
 */
export async function reverseEarningsForRefund(
  tx: Db,
  refundId: string,
): Promise<ReverseEarningsResult> {
  const refund = await tx.refund.findUnique({
    where: { id: refundId },
    select: {
      id: true,
      refundNumber: true,
      amountPaise: true,
      orderId: true,
      returnRequest: { select: { orderItemId: true, quantity: true } },
      order: {
        select: {
          orderNumber: true,
          items: {
            where: { sellerId: { not: null } },
            select: {
              id: true,
              sellerId: true,
              quantity: true,
              lineTotalPaise: true,
              titleSnapshot: true,
            },
          },
        },
      },
    },
  });
  if (!refund) throw new FinanceError("NOT_FOUND", "Refund not found.", { refundId });

  const marker = `[${refund.refundNumber}]`;
  const already = await tx.sellerLedgerEntry.count({
    where: { orderId: refund.orderId, type: "REFUND_REVERSAL", description: { contains: marker } },
  });
  if (already > 0) {
    return { refundId, entriesCreated: 0, sellerIds: [], alreadyReversed: true };
  }

  // Which lines, and what fraction of each: an RMA refund names one line and
  // a unit count; an order-level refund is spread by line total.
  const targets: Array<{ itemId: string; num: number; den: number }> = [];
  if (refund.returnRequest) {
    const item = refund.order.items.find((row) => row.id === refund.returnRequest?.orderItemId);
    if (item) targets.push({ itemId: item.id, num: refund.returnRequest.quantity, den: item.quantity });
  } else {
    // Spread by line total: each line gives up the same fraction of its
    // earnings as the refund is of the order's seller lines.
    const total = refund.order.items.reduce((sum, item) => sum + item.lineTotalPaise, 0);
    for (const item of refund.order.items) {
      if (total <= 0) break;
      targets.push({ itemId: item.id, num: refund.amountPaise, den: total });
    }
  }
  if (targets.length === 0) {
    return { refundId, entriesCreated: 0, sellerIds: [], alreadyReversed: false };
  }

  const ledger = await tx.sellerLedgerEntry.findMany({
    where: {
      orderItemId: { in: targets.map((target) => target.itemId) },
      type: { in: ["SALE", "COMMISSION", "REFUND_REVERSAL"] },
    },
    select: { orderItemId: true, type: true, amountPaise: true, sellerId: true },
  });

  const rows: Prisma.SellerLedgerEntryCreateManyInput[] = [];
  const sellerIds = new Set<string>();
  const now = new Date();

  for (const target of targets) {
    const mine = ledger.filter((row) => row.orderItemId === target.itemId);
    const sale = mine.find((row) => row.type === "SALE");
    if (!sale) continue; // Not delivered yet: nothing was ever earned.
    const commission = mine.find((row) => row.type === "COMMISSION");
    const item = refund.order.items.find((row) => row.id === target.itemId);

    const saleReversed = -mine
      .filter((row) => row.type === "REFUND_REVERSAL" && row.amountPaise < 0)
      .reduce((sum, row) => sum + row.amountPaise, 0);
    const commissionReversed = mine
      .filter((row) => row.type === "REFUND_REVERSAL" && row.amountPaise > 0)
      .reduce((sum, row) => sum + row.amountPaise, 0);

    const remainingSale = sale.amountPaise - saleReversed;
    const remainingCommission = -(commission?.amountPaise ?? 0) - commissionReversed;
    if (remainingSale <= 0) continue;

    // Fraction of the ORIGINAL; proRata hands the last unit the exact remainder.
    const saleShare = Math.min(remainingSale, proRata(sale.amountPaise, target.num, target.den, saleReversed));
    const commissionShare = Math.min(
      remainingCommission,
      proRata(-(commission?.amountPaise ?? 0), target.num, target.den, commissionReversed),
    );

    const label = `${marker} ${refund.order.orderNumber} · ${item?.titleSnapshot ?? ""}`.trim();
    const base = {
      sellerId: sale.sellerId,
      orderId: refund.orderId,
      orderItemId: target.itemId,
      status: "AVAILABLE",
      availableAt: now,
    };
    if (saleShare > 0) {
      rows.push({ ...base, type: "REFUND_REVERSAL", amountPaise: -saleShare, description: `Refund reversal (sale) ${label}` });
    }
    if (commissionShare > 0) {
      rows.push({ ...base, type: "REFUND_REVERSAL", amountPaise: commissionShare, description: `Refund reversal (commission) ${label}` });
    }
    sellerIds.add(sale.sellerId);
  }

  if (rows.length > 0) await tx.sellerLedgerEntry.createMany({ data: rows });
  for (const sellerId of sellerIds) await recomputeSellerBalance(tx, sellerId);

  return { refundId, entriesCreated: rows.length, sellerIds: [...sellerIds], alreadyReversed: false };
}

// ---------------------------------------------------------------------------
// Hold expiry (B4) - job `earnings.mark_available`
// ---------------------------------------------------------------------------

/**
 * PENDING → AVAILABLE once the hold has passed, unless the line has an open
 * return request - a refund may still claw the earning back. Runs its own
 * transaction because it is a job, not a side effect of another change.
 */
export async function markEarningsAvailable(now: Date = new Date()): Promise<{
  updated: number;
  sellerIds: string[];
}> {
  return db.$transaction(async (tx) => {
    const blocked = await tx.returnRequest.findMany({
      where: { status: { in: [...OPEN_RETURN_STATUSES] } },
      select: { orderItemId: true },
    });
    const blockedItemIds = blocked.map((row) => row.orderItemId);

    const due = await tx.sellerLedgerEntry.findMany({
      where: {
        status: "PENDING",
        availableAt: { lte: now },
        ...(blockedItemIds.length > 0
          ? { OR: [{ orderItemId: null }, { orderItemId: { notIn: blockedItemIds } }] }
          : {}),
      },
      select: { id: true, sellerId: true },
    });
    if (due.length === 0) return { updated: 0, sellerIds: [] };

    const result = await tx.sellerLedgerEntry.updateMany({
      where: { id: { in: due.map((row) => row.id) } },
      data: { status: "AVAILABLE" },
    });

    const sellerIds = [...new Set(due.map((row) => row.sellerId))];
    for (const sellerId of sellerIds) await recomputeSellerBalance(tx, sellerId);
    return { updated: result.count, sellerIds };
  });
}

/** Job handler body for `earnings.mark_available`. */
export async function markEarningsAvailableJob(): Promise<{ updated: number; sellers: number }> {
  const result = await markEarningsAvailable();
  return { updated: result.updated, sellers: result.sellerIds.length };
}

/** Refund cap helper (B6): amount still refundable on an order. */
export async function refundableRemaining(tx: Db, orderId: string): Promise<number> {
  const [paid, counted] = await Promise.all([
    tx.orderPayment.aggregate({
      where: { orderId, status: "SUCCEEDED", type: { in: ["CHARGE", "CAPTURE"] } },
      _sum: { amountPaise: true },
    }),
    tx.refund.aggregate({
      where: { orderId, status: { in: [...COUNTED_REFUND_STATUSES] } },
      _sum: { amountPaise: true },
    }),
  ]);
  return Math.max(0, (paid._sum.amountPaise ?? 0) - (counted._sum.amountPaise ?? 0));
}
