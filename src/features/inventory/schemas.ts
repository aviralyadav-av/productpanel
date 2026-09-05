import { z } from "zod";

import { STOCK_MOVEMENT_TYPES, type StockMovementType } from "@/lib/enums";

/**
 * SALE is the one movement type an operator may not write by hand.
 *
 * A SALE row carries an orderId and is created by the order flow in the same
 * transaction that consumes the stock. Letting someone type one in here would
 * put a sale in the ledger that no order can account for, which is exactly the
 * kind of drift the ledger exists to prevent. Everything else - a purchase
 * arriving, a customer return, damaged stock, a counting correction - is a
 * legitimate manual entry.
 */
export const ADJUSTABLE_STOCK_MOVEMENT_TYPES = [
  "PURCHASE",
  "RETURN",
  "ADJUSTMENT",
  "CORRECTION",
  "DAMAGE",
  "SEED",
] as const satisfies readonly StockMovementType[];

export type AdjustableStockMovementType =
  (typeof ADJUSTABLE_STOCK_MOVEMENT_TYPES)[number];

export const adjustableStockMovementTypeSchema = z.enum(
  ADJUSTABLE_STOCK_MOVEMENT_TYPES,
);

/**
 * "SET" writes an absolute count (a stock take), "DELTA" adds or subtracts.
 * Both end up as one signed ledger row; the mode only decides how the operator
 * expresses the change.
 */
export const ADJUST_MODES = ["SET", "DELTA"] as const;
export type AdjustMode = (typeof ADJUST_MODES)[number];
export const adjustModeSchema = z.enum(ADJUST_MODES);

/**
 * A generous but finite bound. Without it a mistyped quantity can write an
 * integer the Int column cannot hold, and the failure surfaces as a database
 * error rather than a field message.
 */
const QUANTITY_LIMIT = 1_000_000;

const quantitySchema = z
  .number({ error: "Enter a number." })
  .int("Whole units only - stock is not divisible.")
  .min(-QUANTITY_LIMIT, "That number is too large.")
  .max(QUANTITY_LIMIT, "That number is too large.");

const thresholdSchema = z
  .number({ error: "Enter a number." })
  .int("Whole units only.")
  .min(0, "A threshold cannot be negative.")
  .max(QUANTITY_LIMIT, "That number is too large.");

const noteSchema = z
  .string()
  .trim()
  .max(500, "Keep the note under 500 characters.")
  .optional();

export const adjustStockSchema = z
  .object({
    variantId: z.string().min(1, "Pick a variant."),
    mode: adjustModeSchema,
    quantity: quantitySchema,
    type: adjustableStockMovementTypeSchema,
    note: noteSchema,
    /** Optional: the dialog edits the threshold alongside the count. */
    lowStockThreshold: thresholdSchema.optional(),
  })
  .refine((value) => value.mode !== "SET" || value.quantity >= 0, {
    message: "A stock take cannot be a negative number.",
    path: ["quantity"],
  });

export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

/**
 * Capped at 100 because the whole batch runs inside one interactive
 * transaction: every variant needs its own read, write and ledger row, and a
 * transaction that holds row locks for longer than a few seconds is a worse
 * problem than a second click.
 */
export const BULK_ADJUST_LIMIT = 100;

export const bulkAdjustStockSchema = z
  .object({
    variantIds: z
      .array(z.string().min(1))
      .min(1, "Select at least one variant.")
      .max(BULK_ADJUST_LIMIT, `Adjust at most ${BULK_ADJUST_LIMIT} variants at a time.`),
    mode: adjustModeSchema,
    quantity: quantitySchema,
    type: adjustableStockMovementTypeSchema,
    note: noteSchema,
  })
  .refine((value) => value.mode !== "SET" || value.quantity >= 0, {
    message: "A stock take cannot be a negative number.",
    path: ["quantity"],
  });

export type BulkAdjustStockInput = z.infer<typeof bulkAdjustStockSchema>;

export const setLowStockThresholdSchema = z.object({
  variantId: z.string().min(1, "Pick a variant."),
  lowStockThreshold: thresholdSchema,
});

export type SetLowStockThresholdInput = z.infer<
  typeof setLowStockThresholdSchema
>;

// --- URL filter values ------------------------------------------------------

export const stockStateFilterSchema = z.enum([
  "IN_STOCK",
  "LOW_STOCK",
  "OUT_OF_STOCK",
]);

export const movementTypeFilterSchema = z.enum(STOCK_MOVEMENT_TYPES);

export const INVENTORY_SORTS = ["available", "title", "onHand"] as const;
export type InventorySort = (typeof INVENTORY_SORTS)[number];
export const inventorySortSchema = z.enum(INVENTORY_SORTS);
