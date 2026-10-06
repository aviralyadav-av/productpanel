import { db } from "@/lib/db";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { conflict, notFound, validationError, type ApiError } from "@/lib/api/errors";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import type { StockState } from "@/lib/enums";
import {
  InventoryError,
  afterStockChange,
  applyStockAdjustment,
  setLowStockThreshold,
  type StockAdjustmentResult,
  type StockChange,
} from "./service";
import type {
  AdjustStockValues,
  BulkAdjustStockValues,
  BulkSetThresholdValues,
  SetThresholdValues,
} from "./schemas";
import { formatSigned } from "./stock-math";

/**
 * The write orchestration behind every manual stock change, shared by the
 * Server Actions (admin UI) and the REST routes so the two can never drift:
 *
 *   permission (caller) → zod (caller) → service in ONE transaction →
 *   audit → after-commit side effects (notifications, facet recompute,
 *   public cache) → result.
 *
 * No `server-only` and no `next/*` here so the same code runs from a route
 * handler, an action or a script. Path revalidation is the action's job.
 *
 * Every InventoryError becomes an ApiError with a sentence an operator can
 * act on; runAction and withAdminApi both know how to render those.
 */

export type VariantLabel = { variantId: string; label: string; productId: string };

async function labelVariants(variantIds: readonly string[]): Promise<Map<string, VariantLabel>> {
  const rows = await db.productVariant.findMany({
    where: { id: { in: [...variantIds] } },
    take: variantIds.length,
    select: { id: true, name: true, sku: true, product: { select: { id: true, title: true } } },
  });
  return new Map(
    rows.map((row) => [
      row.id,
      {
        variantId: row.id,
        productId: row.product.id,
        label:
          row.name && row.name !== "Default"
            ? `${row.product.title} · ${row.name}${row.sku ? ` (${row.sku})` : ""}`
            : `${row.product.title}${row.sku ? ` (${row.sku})` : ""}`,
      },
    ]),
  );
}

/** InventoryError → ApiError. `label` names the variant in the sentence. */
export function toApiError(error: InventoryError, label?: string): ApiError {
  const who = label ? ` for ${label}` : "";
  switch (error.code) {
    case "VARIANT_NOT_FOUND":
      return notFound("Variant");
    case "INSUFFICIENT_STOCK": {
      const available = Number(error.details?.available ?? 0);
      return conflict(
        `Stock cannot go below zero${who}: only ${Math.max(0, available)} available. Enable backorders on the variant to allow a negative balance.`,
        { quantity: "Exceeds the available stock." },
      );
    }
    case "RESERVATION_UNDERFLOW":
      return conflict(`Cannot release more than is reserved${who}.`);
    case "INVALID_QUANTITY":
    default:
      return validationError({ quantity: error.message }, error.message);
  }
}

export function isInventoryError(error: unknown): error is InventoryError {
  return error instanceof InventoryError;
}

/** Fire the after-commit side effects for a batch of changes, once each. */
async function settleChanges(changes: readonly StockChange[]): Promise<void> {
  for (const change of changes) await afterStockChange(change.variantId, change);
  if (changes.length > 0) await invalidatePublic(listTagsFor("inventory"));
}

// ---------------------------------------------------------------------------
// Single adjustment
// ---------------------------------------------------------------------------

export type AdjustOutcome = {
  variantId: string;
  productId: string;
  label: string;
  moved: boolean;
  delta: number;
  onHand: number;
  reserved: number;
  available: number;
  stockState: StockState;
  message: string;
};

export async function adjustStockForActor(
  actor: AuditActor,
  values: AdjustStockValues,
): Promise<AdjustOutcome> {
  const labels = await labelVariants([values.variantId]);
  const target = labels.get(values.variantId);
  if (!target) throw notFound("Variant");

  let result: StockAdjustmentResult;
  try {
    result = await db.$transaction((tx) =>
      applyStockAdjustment(tx, {
        variantId: values.variantId,
        mode: values.mode,
        quantity: values.quantity,
        type: values.type,
        reason: values.reason ?? null,
        note: values.note ?? null,
        actorId: actor.id,
      }),
    );
  } catch (error) {
    if (isInventoryError(error)) throw toApiError(error, target.label);
    throw error;
  }

  if (result.moved && result.change) {
    await settleChanges([result.change]);
    await writeAudit({
      actor,
      action: "inventory.adjust",
      entityType: "ProductVariant",
      entityId: values.variantId,
      entityLabel: target.label,
      summary: `${target.label}: ${formatSigned(result.delta)} (${values.type}) → ${result.after.onHand} on hand${values.reason ? ` · ${values.reason}` : ""}`,
      diff: diffOf(
        { onHand: result.before.onHand, available: result.before.available },
        { onHand: result.after.onHand, available: result.after.available },
      ),
    });
  }

  return {
    variantId: values.variantId,
    productId: target.productId,
    label: target.label,
    moved: result.moved,
    delta: result.delta,
    onHand: result.after.onHand,
    reserved: result.after.reserved,
    available: result.after.available,
    stockState: result.after.stockState,
    message: result.moved
      ? `${target.label} is now at ${result.after.onHand} on hand (${formatSigned(result.delta)}).`
      : `Nothing moved: ${target.label} is already at ${result.after.onHand} on hand.`,
  };
}

// ---------------------------------------------------------------------------
// Bulk adjustment (§11.33: one transaction, capped, summary result)
// ---------------------------------------------------------------------------

/** 500 variants × (lock + movement + projection) needs more than Prisma's 5s default. */
const BULK_TRANSACTION_TIMEOUT_MS = 60_000;

export type BulkAdjustOutcome = {
  requested: number;
  moved: number;
  unchanged: number;
  results: Array<Pick<StockAdjustmentResult, "variantId" | "delta" | "moved"> & { onHand: number }>;
  message: string;
};

export async function bulkAdjustStockForActor(
  actor: AuditActor,
  values: BulkAdjustStockValues,
): Promise<BulkAdjustOutcome> {
  const labels = await labelVariants(values.variantIds);
  const missing = values.variantIds.filter((id) => !labels.has(id));
  if (missing.length > 0) {
    throw notFound(missing.length === values.variantIds.length ? "Variant" : `${missing.length} of the selected variants`);
  }

  // All-or-nothing: a stock take that half-applied is worse than none, because
  // the operator cannot tell which half landed. The first refusal rolls back
  // everything and names the variant.
  let current: string | undefined;
  let results: StockAdjustmentResult[];
  try {
    results = await db.$transaction(
      async (tx) => {
        const out: StockAdjustmentResult[] = [];
        for (const variantId of values.variantIds) {
          current = variantId;
          out.push(
            await applyStockAdjustment(tx, {
              variantId,
              mode: values.mode,
              quantity: values.quantity,
              type: values.type,
              reason: values.reason ?? null,
              note: values.note ?? null,
              actorId: actor.id,
            }),
          );
        }
        return out;
      },
      { timeout: BULK_TRANSACTION_TIMEOUT_MS },
    );
  } catch (error) {
    if (isInventoryError(error)) throw toApiError(error, current ? labels.get(current)?.label : undefined);
    throw error;
  }

  const changes = results.flatMap((row) => (row.change ? [row.change] : []));
  await settleChanges(changes);

  const moved = changes.length;
  await writeAudit({
    actor,
    action: "inventory.bulk_adjust",
    entityType: "InventoryItem",
    entityId: null,
    summary: `Bulk ${values.mode} ${values.quantity} (${values.type}) on ${values.variantIds.length} variants; ${moved} moved${values.reason ? ` · ${values.reason}` : ""}`,
    diff: diffOf(null, {
      mode: values.mode,
      quantity: values.quantity,
      type: values.type,
      reason: values.reason ?? null,
      idCount: values.variantIds.length,
      variants: results.map((row) => ({ variantId: row.variantId, from: row.before.onHand, to: row.after.onHand })),
    }),
  });

  return {
    requested: values.variantIds.length,
    moved,
    unchanged: results.length - moved,
    results: results.map((row) => ({
      variantId: row.variantId,
      delta: row.delta,
      moved: row.moved,
      onHand: row.after.onHand,
    })),
    message:
      moved === 0
        ? "Nothing moved: every selected variant was already at that count."
        : `Updated ${moved} of ${values.variantIds.length} variants.`,
  };
}

// ---------------------------------------------------------------------------
// Thresholds (no ledger row: a reporting rule, not stock)
// ---------------------------------------------------------------------------

export type ThresholdOutcome = {
  variantId: string;
  lowStockThreshold: number;
  allowBackorder: boolean;
  stockState: StockState;
  message: string;
};

export async function setThresholdForActor(
  actor: AuditActor,
  values: SetThresholdValues,
): Promise<ThresholdOutcome> {
  const labels = await labelVariants([values.variantId]);
  const target = labels.get(values.variantId);
  if (!target) throw notFound("Variant");

  const before = await db.inventoryItem.findUnique({
    where: { variantId: values.variantId },
    select: { lowStockThreshold: true, allowBackorder: true, stockState: true },
  });

  const after = await db.$transaction((tx) =>
    setLowStockThreshold(tx, values.variantId, values.lowStockThreshold, {
      allowBackorder: values.allowBackorder,
    }),
  );

  // Flipping allowBackorder can move OUT_OF_STOCK ↔ BACKORDER, which the
  // storefront renders differently, so the public cache is refreshed too.
  if (before?.stockState !== after.stockState) await invalidatePublic(listTagsFor("inventory"));

  await writeAudit({
    actor,
    action: "inventory.set_threshold",
    entityType: "ProductVariant",
    entityId: values.variantId,
    entityLabel: target.label,
    summary: `${target.label}: low-stock threshold ${before?.lowStockThreshold ?? "-"} → ${after.lowStockThreshold}, backorder ${after.allowBackorder ? "on" : "off"}`,
    diff: diffOf(
      { lowStockThreshold: before?.lowStockThreshold ?? null, allowBackorder: before?.allowBackorder ?? null },
      { lowStockThreshold: after.lowStockThreshold, allowBackorder: after.allowBackorder },
    ),
  });

  return {
    variantId: values.variantId,
    ...after,
    message: `${target.label} now reports low stock at ${after.lowStockThreshold} or fewer${after.allowBackorder ? " and accepts backorders" : ""}.`,
  };
}

export async function bulkSetThresholdForActor(
  actor: AuditActor,
  values: BulkSetThresholdValues,
): Promise<{ updated: number; message: string }> {
  const labels = await labelVariants(values.variantIds);
  const ids = values.variantIds.filter((id) => labels.has(id));
  if (ids.length === 0) throw notFound("Variant");

  const results = await db.$transaction(
    async (tx) => {
      const out: Array<{ variantId: string; stockState: StockState }> = [];
      for (const variantId of ids) {
        const row = await setLowStockThreshold(tx, variantId, values.lowStockThreshold, {
          allowBackorder: values.allowBackorder,
        });
        out.push({ variantId, stockState: row.stockState });
      }
      return out;
    },
    { timeout: BULK_TRANSACTION_TIMEOUT_MS },
  );

  await invalidatePublic(listTagsFor("inventory"));
  await writeAudit({
    actor,
    action: "inventory.bulk_set_threshold",
    entityType: "InventoryItem",
    entityId: null,
    summary: `Low-stock threshold set to ${values.lowStockThreshold}${values.allowBackorder === undefined ? "" : `, backorder ${values.allowBackorder ? "on" : "off"}`} on ${ids.length} variants`,
    diff: diffOf(null, {
      lowStockThreshold: values.lowStockThreshold,
      allowBackorder: values.allowBackorder ?? null,
      idCount: ids.length,
      variantIds: ids,
    }),
  });

  return {
    updated: results.length,
    message: `Threshold updated on ${results.length} variant${results.length === 1 ? "" : "s"}.`,
  };
}
