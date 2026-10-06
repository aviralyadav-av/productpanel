import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import {
  stockMovementTypeSchema,
  stockState,
  type StockMovementType,
  type StockState,
} from "@/lib/enums";
import { enqueue } from "@/lib/queue";
import { emitEvent } from "@/features/notifications/service";
import { readSettingBoolean, readSettingNumber } from "@/features/finance/settings-reader";
import { resolveDelta, type AdjustMode } from "./stock-math";

/**
 * Stock movements (blueprint §10, §11.7, §11.29, C3, F7).
 *
 * THE LEDGER IS THE SOURCE OF TRUTH. `InventoryItem` is a projection of
 * `StockMovement`: replaying every movement for a variant must reproduce its
 * `onHand` and `reserved` exactly. That is why the only way to change either
 * column is `applyStockMovement()`, which writes the movement and the
 * projection in the caller's transaction, and why it locks the row first -
 * two orders confirming the last unit at the same moment must serialise, or
 * one of them sells stock that does not exist.
 *
 * The lock is `SELECT ... FOR UPDATE` through `$queryRaw` because Prisma has no
 * row-lock API. Everything after the lock is ordinary Prisma on the same
 * transaction client, so the lock holds until the caller commits.
 */

type Db = Prisma.TransactionClient;

export class InventoryError extends Error {
  constructor(
    public readonly code:
      | "VARIANT_NOT_FOUND"
      | "INSUFFICIENT_STOCK"
      | "RESERVATION_UNDERFLOW"
      | "INVALID_QUANTITY",
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "InventoryError";
  }
}

export type StockMovementInput = {
  variantId: string;
  /** Signed change to onHand. */
  delta: number;
  /** Signed change to reserved (RESERVE +q, RELEASE/SALE -q). */
  reservedDelta?: number;
  type: StockMovementType;
  reason?: string | null;
  note?: string | null;
  orderId?: string | null;
  actorId?: string | null;
  /** Permit available < 0 even when the item does not allow backorders. */
  allowNegative?: boolean;
};

export type StockChange = {
  variantId: string;
  movementId: string;
  onHand: number;
  reserved: number;
  available: number;
  stockState: StockState;
  lowStockThreshold: number;
  /** available fell from above the threshold to within it (still > 0). */
  crossedLow: boolean;
  /** available fell from > 0 to <= 0. */
  crossedZero: boolean;
  /** available rose from <= 0 to > 0 - facets must include this variant again. */
  recovered: boolean;
};

type LockedItem = {
  id: string;
  onHand: number;
  reserved: number;
  lowStockThreshold: number;
  allowBackorder: boolean;
};

async function lockItem(tx: Db, variantId: string): Promise<LockedItem | null> {
  const rows = await tx.$queryRaw<LockedItem[]>`
    SELECT id, "onHand", reserved, "lowStockThreshold", "allowBackorder"
      FROM "InventoryItem"
     WHERE "variantId" = ${variantId}
     FOR UPDATE`;
  return rows[0] ?? null;
}

/**
 * Create the InventoryItem for a variant that has none, with the seeded
 * defaults for threshold/backorder and a SEED movement recording the opening
 * balance - so the ledger starts at the same instant the projection does.
 * Returns the existing row untouched when one already exists.
 */
export async function ensureInventoryItem(
  tx: Db,
  variantId: string,
  opening: { onHand?: number; actorId?: string | null; note?: string | null } = {},
): Promise<{ created: boolean; item: LockedItem }> {
  const existing = await lockItem(tx, variantId);
  if (existing) return { created: false, item: existing };

  const variant = await tx.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true },
  });
  if (!variant) {
    throw new InventoryError("VARIANT_NOT_FOUND", "That variant does not exist.", { variantId });
  }

  const [threshold, allowBackorder] = await Promise.all([
    readSettingNumber(tx, "inventory.default_low_stock_threshold"),
    readSettingBoolean(tx, "inventory.allow_backorder_default"),
  ]);
  const onHand = Math.max(0, Math.trunc(opening.onHand ?? 0));

  const item = await tx.inventoryItem.create({
    data: {
      variantId,
      onHand,
      reserved: 0,
      available: onHand,
      stockState: stockState(onHand, threshold, allowBackorder),
      lowStockThreshold: threshold,
      allowBackorder,
    },
    select: { id: true, onHand: true, reserved: true, lowStockThreshold: true, allowBackorder: true },
  });

  await tx.stockMovement.create({
    data: {
      variantId,
      delta: onHand,
      reservedDelta: 0,
      type: "SEED",
      reason: "Opening balance",
      note: opening.note ?? null,
      actorId: opening.actorId ?? null,
      balance: onHand,
      reservedBalance: 0,
    },
  });

  // Lock the fresh row like any other so the caller's movement serialises.
  const locked = await lockItem(tx, variantId);
  return { created: true, item: locked ?? item };
}

/**
 * The one write path for stock. Locks the row, validates the result, writes
 * the movement with its running balances, then updates the projection.
 */
export async function applyStockMovement(
  tx: Db,
  input: StockMovementInput,
): Promise<StockChange> {
  const type = stockMovementTypeSchema.parse(input.type);
  const delta = Math.trunc(input.delta);
  const reservedDelta = Math.trunc(input.reservedDelta ?? 0);
  if (!Number.isSafeInteger(delta) || !Number.isSafeInteger(reservedDelta)) {
    throw new InventoryError("INVALID_QUANTITY", "Stock changes must be whole numbers.");
  }

  const { item } = await ensureInventoryItem(tx, input.variantId, { actorId: input.actorId });

  const previousAvailable = item.onHand - item.reserved;
  const onHand = item.onHand + delta;
  const reserved = item.reserved + reservedDelta;
  const available = onHand - reserved;

  if (reserved < 0) {
    // Releasing more than was reserved means a caller lost track of its own
    // reservation. Clamping would hide the bug inside the ledger forever.
    throw new InventoryError(
      "RESERVATION_UNDERFLOW",
      "Cannot release more stock than is reserved.",
      { variantId: input.variantId, reserved: item.reserved, reservedDelta },
    );
  }

  const mayGoNegative = item.allowBackorder || input.allowNegative === true;
  if ((available < 0 || onHand < 0) && !mayGoNegative) {
    throw new InventoryError(
      "INSUFFICIENT_STOCK",
      `Only ${Math.max(0, previousAvailable)} available.`,
      { variantId: input.variantId, available: previousAvailable, requested: -delta - reservedDelta },
    );
  }

  const movement = await tx.stockMovement.create({
    data: {
      variantId: input.variantId,
      delta,
      reservedDelta,
      type,
      reason: input.reason ?? null,
      note: input.note ?? null,
      orderId: input.orderId ?? null,
      actorId: input.actorId ?? null,
      balance: onHand,
      reservedBalance: reserved,
    },
    select: { id: true },
  });

  const state = stockState(available, item.lowStockThreshold, item.allowBackorder);
  await tx.inventoryItem.update({
    where: { id: item.id },
    data: { onHand, reserved, available, stockState: state },
  });

  return {
    variantId: input.variantId,
    movementId: movement.id,
    onHand,
    reserved,
    available,
    stockState: state,
    lowStockThreshold: item.lowStockThreshold,
    crossedLow:
      previousAvailable > item.lowStockThreshold &&
      available <= item.lowStockThreshold &&
      available > 0,
    crossedZero: previousAvailable > 0 && available <= 0,
    recovered: previousAvailable <= 0 && available > 0,
  };
}

// ---------------------------------------------------------------------------
// C3 wrappers - one per row of the transition → movement table, so callers
// cannot get a sign wrong.
// ---------------------------------------------------------------------------

type OrderMovement = {
  variantId: string;
  quantity: number;
  orderId: string;
  actorId?: string | null;
  note?: string | null;
};

function positive(quantity: number): number {
  const value = Math.trunc(quantity);
  if (!(value > 0)) {
    throw new InventoryError("INVALID_QUANTITY", "Quantity must be a positive whole number.");
  }
  return value;
}

/** Order created (PENDING): hold units without taking them off the shelf. */
export function reserveStock(tx: Db, input: OrderMovement): Promise<StockChange> {
  return applyStockMovement(tx, {
    variantId: input.variantId,
    delta: 0,
    reservedDelta: positive(input.quantity),
    type: "RESERVE",
    reason: "ORDER_PENDING",
    orderId: input.orderId,
    actorId: input.actorId,
    note: input.note,
  });
}

/** PENDING → CANCELLED | FAILED: drop the hold. */
export function releaseStock(tx: Db, input: OrderMovement): Promise<StockChange> {
  return applyStockMovement(tx, {
    variantId: input.variantId,
    delta: 0,
    reservedDelta: -positive(input.quantity),
    type: "RELEASE",
    reason: "ORDER_RELEASED",
    orderId: input.orderId,
    actorId: input.actorId,
    note: input.note,
  });
}

/** PENDING → CONFIRMED: the held units leave stock for good. */
export function commitReservation(tx: Db, input: OrderMovement): Promise<StockChange> {
  const quantity = positive(input.quantity);
  return applyStockMovement(tx, {
    variantId: input.variantId,
    delta: -quantity,
    reservedDelta: -quantity,
    type: "SALE",
    reason: "ORDER_CONFIRMED",
    orderId: input.orderId,
    actorId: input.actorId,
    note: input.note,
  });
}

/** Replacement shipped / manual sale without a prior reservation. */
export function recordSale(tx: Db, input: OrderMovement & { reason?: string }): Promise<StockChange> {
  return applyStockMovement(tx, {
    variantId: input.variantId,
    delta: -positive(input.quantity),
    reservedDelta: 0,
    type: "SALE",
    reason: input.reason ?? "SALE",
    orderId: input.orderId,
    actorId: input.actorId,
    note: input.note,
  });
}

/**
 * Units back on the shelf: cancellation after confirmation, RTO, return QC
 * passed, or a restock disposition. `reason` names which (C3).
 */
export function restock(
  tx: Db,
  input: Omit<OrderMovement, "orderId"> & { orderId?: string | null; reason: string },
): Promise<StockChange> {
  return applyStockMovement(tx, {
    variantId: input.variantId,
    delta: positive(input.quantity),
    reservedDelta: 0,
    type: "RETURN",
    reason: input.reason,
    orderId: input.orderId ?? null,
    actorId: input.actorId,
    note: input.note,
  });
}

// ---------------------------------------------------------------------------
// Manual adjustments (admin UI, REST, CSV import)
// ---------------------------------------------------------------------------

export type StockAdjustmentInput = {
  variantId: string;
  /** add → +quantity, remove → −quantity, set → quantity − onHand (read under the lock). */
  mode: AdjustMode;
  quantity: number;
  type: StockMovementType;
  reason?: string | null;
  note?: string | null;
  actorId?: string | null;
};

export type StockAdjustmentResult = {
  variantId: string;
  /** The balances the delta was computed against, read under the row lock. */
  before: { onHand: number; reserved: number; available: number };
  delta: number;
  /** False when the mode/quantity resolved to a zero delta: nothing written. */
  moved: boolean;
  change: StockChange | null;
  after: {
    onHand: number;
    reserved: number;
    available: number;
    stockState: StockState;
    lowStockThreshold: number;
    allowBackorder: boolean;
  };
};

/**
 * A manual adjustment expressed the way an operator thinks about it. The one
 * thing this adds over applyStockMovement is that "set to N" derives its
 * delta from the on-hand figure read under the row lock, so two people
 * counting the same shelf cannot both apply a delta computed from a stale
 * table. A zero delta writes nothing: nothing moved, so nothing belongs in
 * the ledger.
 */
export async function applyStockAdjustment(
  tx: Db,
  input: StockAdjustmentInput,
): Promise<StockAdjustmentResult> {
  const quantity = Math.trunc(input.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new InventoryError("INVALID_QUANTITY", "Quantity must be a whole number of zero or more.");
  }

  // Locks the row (creating it first if the variant was never tracked).
  const { item } = await ensureInventoryItem(tx, input.variantId, { actorId: input.actorId });
  const before = {
    onHand: item.onHand,
    reserved: item.reserved,
    available: item.onHand - item.reserved,
  };
  const delta = resolveDelta(input.mode, quantity, item.onHand);

  if (delta === 0) {
    return {
      variantId: input.variantId,
      before,
      delta: 0,
      moved: false,
      change: null,
      after: {
        ...before,
        stockState: stockState(before.available, item.lowStockThreshold, item.allowBackorder),
        lowStockThreshold: item.lowStockThreshold,
        allowBackorder: item.allowBackorder,
      },
    };
  }

  const change = await applyStockMovement(tx, {
    variantId: input.variantId,
    delta,
    type: input.type,
    reason: input.reason,
    note: input.note,
    actorId: input.actorId,
  });

  return {
    variantId: input.variantId,
    before,
    delta,
    moved: true,
    change,
    after: {
      onHand: change.onHand,
      reserved: change.reserved,
      available: change.available,
      stockState: change.stockState,
      lowStockThreshold: change.lowStockThreshold,
      allowBackorder: item.allowBackorder,
    },
  };
}

// ---------------------------------------------------------------------------
// Threshold, summaries, side effects
// ---------------------------------------------------------------------------

/** A threshold is a reporting rule, not stock: no movement, but the state must follow it. */
export async function setLowStockThreshold(
  tx: Db,
  variantId: string,
  threshold: number,
  options: { allowBackorder?: boolean } = {},
): Promise<{ lowStockThreshold: number; allowBackorder: boolean; stockState: StockState }> {
  const { item } = await ensureInventoryItem(tx, variantId);
  const lowStockThreshold = Math.max(0, Math.trunc(threshold));
  const allowBackorder = options.allowBackorder ?? item.allowBackorder;
  const available = item.onHand - item.reserved;
  const state = stockState(available, lowStockThreshold, allowBackorder);

  await tx.inventoryItem.update({
    where: { id: item.id },
    data: { lowStockThreshold, allowBackorder, stockState: state },
  });

  return { lowStockThreshold, allowBackorder, stockState: state };
}

export type ProductStockSummary = {
  productId: string;
  onHand: number;
  reserved: number;
  available: number;
  /** Best state across active variants: any IN_STOCK wins, then LOW, BACKORDER, OUT. */
  stockState: StockState;
  variants: Array<{
    variantId: string;
    name: string;
    sku: string | null;
    isActive: boolean;
    onHand: number;
    reserved: number;
    available: number;
    stockState: StockState;
    lowStockThreshold: number;
    allowBackorder: boolean;
  }>;
};

const STATE_RANK: Record<StockState, number> = {
  IN_STOCK: 0,
  LOW_STOCK: 1,
  BACKORDER: 2,
  OUT_OF_STOCK: 3,
};

export async function getStockSummaryForProduct(
  productId: string,
  tx?: Db,
): Promise<ProductStockSummary> {
  const variants = await (tx ?? db).productVariant.findMany({
    where: { productId, deletedAt: null },
    orderBy: { position: "asc" },
    select: { id: true, name: true, sku: true, isActive: true, inventory: true },
  });

  const rows = variants.map((variant) => ({
    variantId: variant.id,
    name: variant.name,
    sku: variant.sku,
    isActive: variant.isActive,
    onHand: variant.inventory?.onHand ?? 0,
    reserved: variant.inventory?.reserved ?? 0,
    available: variant.inventory?.available ?? 0,
    stockState: (variant.inventory?.stockState ?? "OUT_OF_STOCK") as StockState,
    lowStockThreshold: variant.inventory?.lowStockThreshold ?? 0,
    allowBackorder: variant.inventory?.allowBackorder ?? false,
  }));

  const active = rows.filter((row) => row.isActive);
  const best = active.reduce<StockState>(
    (state, row) => (STATE_RANK[row.stockState] < STATE_RANK[state] ? row.stockState : state),
    "OUT_OF_STOCK",
  );

  return {
    productId,
    onHand: active.reduce((sum, row) => sum + row.onHand, 0),
    reserved: active.reduce((sum, row) => sum + row.reserved, 0),
    available: active.reduce((sum, row) => sum + row.available, 0),
    stockState: best,
    variants: rows,
  };
}

/**
 * Side effects that must run AFTER the movement's transaction commits:
 * notifications (an email about stock that rolled back would be wrong) and
 * the facet recompute (A3: a variant crossing zero changes which filter values
 * the product answers to). Callers pass the flags from applyStockMovement.
 */
export async function afterStockChange(
  variantId: string,
  flags: Pick<StockChange, "crossedLow" | "crossedZero" | "recovered"> &
    Partial<Pick<StockChange, "available" | "lowStockThreshold">>,
): Promise<void> {
  if (!flags.crossedLow && !flags.crossedZero && !flags.recovered) return;

  const variant = await db.productVariant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      name: true,
      sku: true,
      productId: true,
      product: { select: { title: true } },
      inventory: { select: { available: true, lowStockThreshold: true } },
    },
  });
  if (!variant) return;

  const available = flags.available ?? variant.inventory?.available ?? 0;
  const threshold = flags.lowStockThreshold ?? variant.inventory?.lowStockThreshold ?? 0;

  if (flags.crossedZero) {
    await emitEvent("stock.out", {
      variantId,
      productId: variant.productId,
      productTitle: variant.product.title,
      variantName: variant.name,
      sku: variant.sku,
      available,
    });
  } else if (flags.crossedLow) {
    await emitEvent("stock.low", {
      variantId,
      productId: variant.productId,
      productTitle: variant.product.title,
      variantName: variant.name,
      sku: variant.sku,
      available,
      threshold,
    });
  }

  if (flags.crossedZero || flags.recovered) {
    // JOB_TYPES has no dedicated facet job; the subtree recompute accepts a
    // product list and rebuilds facets + pricing for exactly these products.
    await enqueue(
      "catalog.recompute_subtree",
      { productIds: [variant.productId] },
      { dedupeKey: `catalog.recompute_subtree:product:${variant.productId}` },
    );
  }
}
