import { z } from "zod";

import {
  STOCK_MOVEMENT_META,
  STOCK_MOVEMENT_TYPES,
  STOCK_STATES,
  type StockMovementType,
  type StockState,
} from "@/lib/enums";
import { one, type SearchParams } from "@/lib/list-params";
import { ADJUST_MODES, type AdjustMode } from "./stock-math";
import { MAX_IMPORT_ROWS } from "./csv";

/**
 * Every write into inventory and every list query is parsed here, once, so
 * the Server Actions, the REST routes and the CSV import agree on what a
 * valid adjustment is (blueprint §11.7, §11.33, F7).
 */

// ---------------------------------------------------------------------------
// Movement types an operator may record by hand
// ---------------------------------------------------------------------------

/**
 * SALE, RESERVE and RELEASE carry an orderId and are written by order flow in
 * the transaction that moves the stock (C3); SEED is the opening balance the
 * service writes when it creates an item. Typing any of them by hand would put
 * a row in the ledger no order can account for.
 */
export const ADJUSTABLE_STOCK_MOVEMENT_TYPES = [
  "PURCHASE",
  "ADJUSTMENT",
  "CORRECTION",
  "DAMAGE",
  "RETURN",
] as const satisfies readonly StockMovementType[];

export type AdjustableStockMovementType = (typeof ADJUSTABLE_STOCK_MOVEMENT_TYPES)[number];
export const adjustableStockMovementTypeSchema = z.enum(ADJUSTABLE_STOCK_MOVEMENT_TYPES);

/** STOCK_MOVEMENT_META leaves some descriptions blank; the dialog needs one for each. */
export const ADJUSTMENT_TYPE_DESCRIPTIONS: Record<AdjustableStockMovementType, string> = {
  PURCHASE: STOCK_MOVEMENT_META.PURCHASE.description ?? "Stock received from a seller or supplier.",
  ADJUSTMENT: STOCK_MOVEMENT_META.ADJUSTMENT.description ?? "A manual change with no better category.",
  CORRECTION: STOCK_MOVEMENT_META.CORRECTION.description ?? "Fixing a count that was wrong - a stock take or data-entry fix.",
  DAMAGE: STOCK_MOVEMENT_META.DAMAGE.description ?? "Units damaged, lost or written off.",
  RETURN: STOCK_MOVEMENT_META.RETURN.description ?? "Units back on the shelf outside the returns flow.",
};

export const COMMON_ADJUSTMENT_REASONS = [
  "Stock take",
  "Supplier delivery",
  "Damaged in storage",
  "Customer return (manual)",
  "Sample or display unit",
  "Data entry correction",
  "Transfer between locations",
] as const;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * A generous but finite bound: without it a mistyped quantity can exceed the
 * Int column and surface as a database error instead of a field message.
 */
export const QUANTITY_LIMIT = 1_000_000;

/** §11.33: bulk actions are capped and run in one transaction. */
export const BULK_LIMIT = 500;

export { MAX_IMPORT_ROWS };

/** Seeded variants have readable ids ("demo_var_..."), so this is not a cuid check. */
export const variantIdSchema = z
  .string()
  .trim()
  .min(1, "Pick a variant.")
  .max(64, "Invalid variant id.")
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid variant id.");

export const adjustModeSchema = z.enum(ADJUST_MODES);

export const quantitySchema = z
  .number({ error: "Enter a number." })
  .int("Whole units only - stock is not divisible.")
  .min(0, "Quantity cannot be negative; use Remove to take stock out.")
  .max(QUANTITY_LIMIT, "That number is too large.");

export const thresholdSchema = z
  .number({ error: "Enter a number." })
  .int("Whole units only.")
  .min(0, "A threshold cannot be negative.")
  .max(QUANTITY_LIMIT, "That number is too large.");

export const reasonSchema = z
  .string()
  .trim()
  .max(120, "Keep the reason under 120 characters.")
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

export const noteSchema = z
  .string()
  .trim()
  .max(500, "Keep the note under 500 characters.")
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

const variantIdsSchema = z
  .array(variantIdSchema)
  .min(1, "Select at least one variant.")
  .max(BULK_LIMIT, `Adjust at most ${BULK_LIMIT} variants at a time.`)
  .transform((ids) => [...new Set(ids)]);

/** "set 0" is a real change; "add 0" is not. */
function requirePositiveUnlessSet(value: { mode: AdjustMode; quantity: number }): boolean {
  return value.mode === "set" || value.quantity > 0;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const adjustStockSchema = z
  .object({
    variantId: variantIdSchema,
    mode: adjustModeSchema,
    quantity: quantitySchema,
    type: adjustableStockMovementTypeSchema,
    reason: reasonSchema,
    note: noteSchema,
  })
  .refine(requirePositiveUnlessSet, { message: "Enter at least one unit.", path: ["quantity"] });

export type AdjustStockInput = z.input<typeof adjustStockSchema>;
export type AdjustStockValues = z.output<typeof adjustStockSchema>;

export const bulkAdjustStockSchema = z
  .object({
    variantIds: variantIdsSchema,
    mode: adjustModeSchema,
    quantity: quantitySchema,
    type: adjustableStockMovementTypeSchema,
    reason: reasonSchema,
    note: noteSchema,
  })
  .refine(requirePositiveUnlessSet, { message: "Enter at least one unit.", path: ["quantity"] });

export type BulkAdjustStockInput = z.input<typeof bulkAdjustStockSchema>;
export type BulkAdjustStockValues = z.output<typeof bulkAdjustStockSchema>;

export const setThresholdSchema = z.object({
  variantId: variantIdSchema,
  lowStockThreshold: thresholdSchema,
  allowBackorder: z.boolean().optional(),
});

export type SetThresholdInput = z.input<typeof setThresholdSchema>;
export type SetThresholdValues = z.output<typeof setThresholdSchema>;

export const bulkSetThresholdSchema = z.object({
  variantIds: variantIdsSchema,
  lowStockThreshold: thresholdSchema,
  allowBackorder: z.boolean().optional(),
});

export type BulkSetThresholdInput = z.input<typeof bulkSetThresholdSchema>;
export type BulkSetThresholdValues = z.output<typeof bulkSetThresholdSchema>;

/** PUT /threshold body: the variant comes from the path. */
export const thresholdBodySchema = z.object({
  lowStockThreshold: thresholdSchema,
  allowBackorder: z.boolean().optional(),
});

/** POST /bulk body: one endpoint, two operations, chosen by `op` (default adjust). */
export const BULK_OPS = ["adjust", "threshold"] as const;
export type BulkOp = (typeof BULK_OPS)[number];
export const bulkOpSchema = z.enum(BULK_OPS);

// ---------------------------------------------------------------------------
// CSV import rows
// ---------------------------------------------------------------------------

const lower = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : value);
const upper = (value: unknown) => (typeof value === "string" ? value.trim().toUpperCase() : value);
const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

/**
 * One import row after text → typed parsing. `quantity` accepts numeric
 * strings because it arrives from a CSV cell; `type` is optional and defaults
 * per mode in the mutation (set → CORRECTION, add/remove → ADJUSTMENT).
 */
export const importRowSchema = z
  .object({
    sku: z.string().trim().min(1, "SKU is required.").max(64, "SKU is too long."),
    mode: z.preprocess(lower, adjustModeSchema),
    quantity: z.preprocess((value) => {
      if (typeof value === "number") return value;
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return /^-?\d+$/.test(trimmed) ? Number(trimmed) : trimmed === "" ? undefined : Number.NaN;
    }, quantitySchema),
    reason: z.preprocess(emptyToUndefined, reasonSchema),
    note: z.preprocess(emptyToUndefined, noteSchema),
    type: z.preprocess(
      (value) => emptyToUndefined(upper(value)),
      adjustableStockMovementTypeSchema.optional(),
    ),
  })
  .refine(requirePositiveUnlessSet, { message: "Enter at least one unit.", path: ["quantity"] });

export type ImportRowValues = z.output<typeof importRowSchema>;

/** JSON body alternative to a multipart upload: rows as objects. */
export const importJsonBodySchema = z.object({
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .min(1, "Provide at least one row.")
    .max(MAX_IMPORT_ROWS, `At most ${MAX_IMPORT_ROWS} rows per import.`),
});

// ---------------------------------------------------------------------------
// URL state: tabs, sorts, filters
// ---------------------------------------------------------------------------

export const INVENTORY_TABS = ["levels", "movements", "import", "alerts"] as const;
export type InventoryTab = (typeof INVENTORY_TABS)[number];

export function parseInventoryTab(value: string | undefined): InventoryTab {
  return (INVENTORY_TABS as readonly string[]).includes(value ?? "")
    ? (value as InventoryTab)
    : "levels";
}

export const INVENTORY_SORTS = ["product", "sku", "onHand", "available", "reserved", "updated"] as const;
export type InventorySort = (typeof INVENTORY_SORTS)[number];

export function parseInventorySort(value: string | undefined): InventorySort {
  return (INVENTORY_SORTS as readonly string[]).includes(value ?? "")
    ? (value as InventorySort)
    : "available";
}

export const MOVEMENT_SORTS = ["createdAt", "delta"] as const;
export type MovementSort = (typeof MOVEMENT_SORTS)[number];

export function parseMovementSort(value: string | undefined): MovementSort {
  return (MOVEMENT_SORTS as readonly string[]).includes(value ?? "")
    ? (value as MovementSort)
    : "createdAt";
}

export type InventoryFilters = {
  stock?: StockState;
  categoryId?: string;
  sellerId?: string;
  /** Only items whose low-stock threshold is above zero. */
  thresholdOnly?: boolean;
  /** Restrict to these variants (export of a selection). */
  variantIds?: string[];
};

export type MovementFilters = {
  type?: StockMovementType;
  variantId?: string;
  from?: Date;
  to?: Date;
};

function read(params: SearchParams | URLSearchParams, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  return one(params, key);
}

function readAll(params: SearchParams | URLSearchParams, key: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(key).filter(Boolean);
  const value = params[key];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

export function parseStockState(value: string | undefined): StockState | undefined {
  return (STOCK_STATES as readonly string[]).includes(value ?? "") ? (value as StockState) : undefined;
}

export function parseMovementType(value: string | undefined): StockMovementType | undefined {
  return (STOCK_MOVEMENT_TYPES as readonly string[]).includes(value ?? "")
    ? (value as StockMovementType)
    : undefined;
}

const idParam = variantIdSchema.safeParse;

export function parseInventoryFilters(params: SearchParams | URLSearchParams): InventoryFilters {
  const category = read(params, "category");
  const seller = read(params, "seller");
  const ids = readAll(params, "ids").filter((id) => idParam(id).success).slice(0, BULK_LIMIT);
  return {
    stock: parseStockState(read(params, "stock")),
    categoryId: category && idParam(category).success ? category : undefined,
    sellerId: seller && idParam(seller).success ? seller : undefined,
    thresholdOnly: read(params, "threshold") === "1",
    variantIds: ids.length > 0 ? ids : undefined,
  };
}

/**
 * `?type=&variant=&order=` plus a date window already resolved by the caller
 * (resolveDateRangeParams keeps IST-day semantics in one place). `from`/`to`
 * are only applied when the URL actually carries a range, so the ledger and
 * the history sheet default to "all time" and the picker narrows from there.
 */
export function parseMovementFilters(
  params: SearchParams | URLSearchParams,
  range: { from: Date; to: Date } | null,
  keys: { type?: string; variant?: string; order?: string } = {},
): MovementFilters & { orderId?: string } {
  const variant = read(params, keys.variant ?? "variant");
  const order = read(params, keys.order ?? "order_id");
  return {
    type: parseMovementType(read(params, keys.type ?? "type")),
    variantId: variant && idParam(variant).success ? variant : undefined,
    orderId: order && idParam(order).success ? order : undefined,
    from: range?.from,
    to: range?.to,
  };
}

/** True when the URL names a date window under the given param names. */
export function hasDateWindow(
  params: SearchParams | URLSearchParams,
  keys: { from: string; to: string; preset: string },
): boolean {
  return Boolean(read(params, keys.from) || read(params, keys.to) || read(params, keys.preset));
}

/**
 * The history sheet has its own pagination and filters, namespaced with an
 * `h` prefix so opening it never disturbs the table underneath.
 */
export const HISTORY_PARAMS = {
  variant: "variant",
  page: "hpage",
  type: "htype",
  from: "hfrom",
  to: "hto",
  preset: "hrange",
} as const;

export const HISTORY_PAGE_SIZE = 20;

/** Export scopes: which table the rows come from. */
export const EXPORT_SCOPES = ["levels", "movements"] as const;
export type ExportScope = (typeof EXPORT_SCOPES)[number];
export function parseExportScope(value: string | null | undefined): ExportScope {
  return value === "movements" ? "movements" : "levels";
}
