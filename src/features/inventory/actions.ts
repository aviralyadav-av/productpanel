"use server";

import { revalidatePath } from "next/cache";

import { requireAdminOrThrow } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { diffOf, writeAudit } from "@/lib/audit";
import {
  fail,
  ok,
  runAction,
  zodFail,
  type ActionResult,
} from "@/lib/action-result";
import { stockState, type StockState } from "@/lib/enums";
import {
  adjustStockSchema,
  bulkAdjustStockSchema,
  setLowStockThresholdSchema,
  type AdjustStockInput,
  type BulkAdjustStockInput,
  type SetLowStockThresholdInput,
} from "@/features/inventory/schemas";

/**
 * THE LEDGER IS THE SOURCE OF TRUTH.
 *
 * InventoryItem.onHand is a cached projection of StockMovement. Every change
 * to onHand therefore writes two rows inside ONE db.$transaction:
 *
 *   1. the new InventoryItem.onHand, and
 *   2. a StockMovement whose `delta` is the change and whose `balance` equals
 *      the new onHand exactly.
 *
 * Neither may ever be written without the other. A movement without the
 * matching update makes the count wrong; an update without the movement makes
 * the history a lie, and the history is the only thing that can answer "who
 * took eleven units of the tan tote and when". Replaying every movement for a
 * variant must always reproduce its current onHand.
 *
 * The one case that writes no movement is a change of exactly zero units - a
 * threshold edit, or re-entering the count that is already there. Nothing
 * moved, so nothing belongs in the ledger. That is not an exception to the
 * invariant: onHand did not change either.
 *
 * Every guard runs BEFORE the first write inside the transaction, so an
 * early return leaves the ledger untouched rather than relying on a rollback.
 */

/** The column default in prisma/schema.prisma. */
const DEFAULT_LOW_STOCK_THRESHOLD = 3;

/**
 * A bulk batch is one interactive transaction over up to 100 variants, which
 * needs more than the 5s Prisma allows by default on a cold connection.
 */
const BULK_TRANSACTION_TIMEOUT_MS = 20_000;

type AdjustResult = {
  variantId: string;
  onHand: number;
  available: number;
  state: StockState;
};

function describeChange(
  mode: "SET" | "DELTA",
  nextOnHand: number,
  delta: number,
): string {
  if (mode === "SET") return `Counted, set to ${nextOnHand}`;
  return `${delta > 0 ? "+" : ""}${delta} by hand`;
}

/**
 * Adjust one variant: set an absolute count or apply a signed change, with an
 * optional edit to the low-stock threshold in the same operation.
 */
export async function adjustStock(
  input: AdjustStockInput,
): Promise<ActionResult<AdjustResult>> {
  const actor = await requireAdminOrThrow();

  const parsed = adjustStockSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  const { variantId, mode, quantity, type, note, lowStockThreshold } =
    parsed.data;

  return runAction<AdjustResult>(async () => {
    const outcome = await db.$transaction(async (tx) => {
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId },
        select: {
          id: true,
          name: true,
          inventory: {
            select: { onHand: true, reserved: true, lowStockThreshold: true },
          },
          product: { select: { id: true, title: true } },
        },
      });

      if (!variant) return { kind: "missing" as const };

      const before = variant.inventory?.onHand ?? 0;
      const beforeThreshold =
        variant.inventory?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
      const nextOnHand = mode === "SET" ? quantity : before + quantity;

      if (nextOnHand < 0) {
        return { kind: "negative" as const, before };
      }

      const nextThreshold = lowStockThreshold ?? beforeThreshold;
      const delta = nextOnHand - before;

      const item = await tx.inventoryItem.upsert({
        where: { variantId },
        create: {
          variantId,
          onHand: nextOnHand,
          reserved: 0,
          lowStockThreshold: nextThreshold,
        },
        update: { onHand: nextOnHand, lowStockThreshold: nextThreshold },
      });

      if (delta !== 0) {
        await tx.stockMovement.create({
          data: {
            variantId,
            delta,
            type,
            reason: describeChange(mode, nextOnHand, delta),
            note: note && note.length > 0 ? note : null,
            actorId: actor.id,
            balance: item.onHand,
          },
        });
      }

      return {
        kind: "ok" as const,
        variant,
        item,
        before,
        beforeThreshold,
        delta,
      };
    });

    if (outcome.kind === "missing") {
      return fail("That variant no longer exists. Reload the page.");
    }

    if (outcome.kind === "negative") {
      return fail(
        `Stock cannot go below zero. There ${
          outcome.before === 1 ? "is" : "are"
        } ${outcome.before} on hand right now.`,
      );
    }

    const { variant, item, before, beforeThreshold, delta } = outcome;
    const available = item.onHand - item.reserved;
    const label = `${variant.product.title} (${variant.name})`;

    await writeAudit({
      actor,
      action: "inventory.adjust",
      entityType: "ProductVariant",
      entityId: variant.id,
      summary:
        delta === 0
          ? `${label} low-stock threshold set to ${item.lowStockThreshold}`
          : `${label} stock ${before} to ${item.onHand} (${
              delta > 0 ? "+" : ""
            }${delta}, ${type})`,
      diff: diffOf(
        { onHand: before, lowStockThreshold: beforeThreshold },
        { onHand: item.onHand, lowStockThreshold: item.lowStockThreshold },
      ),
    });

    revalidatePath("/inventory");
    // The dashboard alerts and the sidebar low-stock badge both read this row.
    revalidatePath("/dashboard");

    return ok(
      {
        variantId: variant.id,
        onHand: item.onHand,
        available,
        state: stockState(available, item.lowStockThreshold),
      },
      delta === 0
        ? `Nothing moved. ${label} is still at ${item.onHand} on hand.`
        : `${label} is now at ${item.onHand} on hand.`,
    );
  });
}

/**
 * Apply the same set-to or change-by value to several variants at once.
 *
 * The batch is all-or-nothing: if any one variant would end below zero the
 * whole thing is rejected and named, because a partially applied stock take is
 * worse than none - the operator cannot tell which half landed.
 */
export async function bulkAdjustStock(
  input: BulkAdjustStockInput,
): Promise<ActionResult<{ updated: number }>> {
  const actor = await requireAdminOrThrow();

  const parsed = bulkAdjustStockSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  const { variantIds, mode, quantity, type, note } = parsed.data;
  const uniqueIds = [...new Set(variantIds)];

  return runAction<{ updated: number }>(async () => {
    const outcome = await db.$transaction(
      async (tx) => {
        const variants = await tx.productVariant.findMany({
          where: { id: { in: uniqueIds } },
          select: {
            id: true,
            name: true,
            inventory: { select: { onHand: true, lowStockThreshold: true } },
            product: { select: { title: true } },
          },
        });

        if (variants.length === 0) {
          return { kind: "missing" as const };
        }

        const planned = variants.map((variant) => {
          const before = variant.inventory?.onHand ?? 0;
          return {
            variant,
            before,
            threshold:
              variant.inventory?.lowStockThreshold ??
              DEFAULT_LOW_STOCK_THRESHOLD,
            nextOnHand: mode === "SET" ? quantity : before + quantity,
          };
        });

        const offenders = planned.filter((row) => row.nextOnHand < 0);
        if (offenders.length > 0) {
          return {
            kind: "negative" as const,
            names: offenders.map(
              (row) =>
                `${row.variant.product.title} (${row.variant.name}) has ${row.before}`,
            ),
          };
        }

        // Reads and validation are complete; from here the batch commits or
        // rolls back as one unit.
        for (const row of planned) {
          await tx.inventoryItem.upsert({
            where: { variantId: row.variant.id },
            create: {
              variantId: row.variant.id,
              onHand: row.nextOnHand,
              reserved: 0,
              lowStockThreshold: row.threshold,
            },
            update: { onHand: row.nextOnHand },
          });
        }

        const movements = planned
          .filter((row) => row.nextOnHand !== row.before)
          .map((row) => ({
            variantId: row.variant.id,
            delta: row.nextOnHand - row.before,
            type,
            reason: describeChange(
              mode,
              row.nextOnHand,
              row.nextOnHand - row.before,
            ),
            note: note && note.length > 0 ? note : null,
            actorId: actor.id,
            balance: row.nextOnHand,
          }));

        if (movements.length > 0) {
          await tx.stockMovement.createMany({ data: movements });
        }

        return { kind: "ok" as const, planned, moved: movements.length };
      },
      { timeout: BULK_TRANSACTION_TIMEOUT_MS },
    );

    if (outcome.kind === "missing") {
      return fail("None of those variants exist any more. Reload the page.");
    }

    if (outcome.kind === "negative") {
      return fail(
        `Stock cannot go below zero: ${outcome.names.slice(0, 3).join(", ")}${
          outcome.names.length > 3
            ? ` and ${outcome.names.length - 3} more`
            : ""
        }. Nothing was changed.`,
      );
    }

    await writeAudit({
      actor,
      action: "inventory.bulk_adjust",
      entityType: "InventoryItem",
      entityId: null,
      summary: `${
        mode === "SET" ? `Set ${quantity} on hand for` : `Changed stock by ${quantity} on`
      } ${outcome.planned.length} variant${
        outcome.planned.length === 1 ? "" : "s"
      } (${type})`,
      diff: diffOf(null, {
        mode,
        quantity,
        type,
        variants: outcome.planned.map((row) => ({
          variantId: row.variant.id,
          from: row.before,
          to: row.nextOnHand,
        })),
      }),
    });

    revalidatePath("/inventory");
    revalidatePath("/dashboard");

    return ok(
      { updated: outcome.planned.length },
      outcome.moved === 0
        ? "Nothing moved - every selected variant was already at that count."
        : `Updated ${outcome.moved} variant${outcome.moved === 1 ? "" : "s"}.`,
    );
  });
}

/**
 * Change only the point at which a variant starts reporting low stock.
 *
 * No ledger row: the threshold is a reporting rule, not stock. Nothing moved.
 */
export async function setLowStockThreshold(
  input: SetLowStockThresholdInput,
): Promise<ActionResult<{ variantId: string; lowStockThreshold: number }>> {
  const actor = await requireAdminOrThrow();

  const parsed = setLowStockThresholdSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  const { variantId, lowStockThreshold } = parsed.data;

  return runAction<{ variantId: string; lowStockThreshold: number }>(async () => {
    const variant = await db.productVariant.findUnique({
      where: { id: variantId },
      select: {
        id: true,
        name: true,
        inventory: { select: { lowStockThreshold: true } },
        product: { select: { title: true } },
      },
    });

    if (!variant) {
      return fail("That variant no longer exists. Reload the page.");
    }

    const before =
      variant.inventory?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;

    const item = await db.inventoryItem.upsert({
      where: { variantId },
      create: { variantId, onHand: 0, reserved: 0, lowStockThreshold },
      update: { lowStockThreshold },
    });

    const label = `${variant.product.title} (${variant.name})`;

    await writeAudit({
      actor,
      action: "inventory.set_threshold",
      entityType: "ProductVariant",
      entityId: variant.id,
      summary: `${label} low-stock threshold ${before} to ${item.lowStockThreshold}`,
      diff: diffOf(
        { lowStockThreshold: before },
        { lowStockThreshold: item.lowStockThreshold },
      ),
    });

    revalidatePath("/inventory");
    revalidatePath("/dashboard");

    return ok(
      { variantId: variant.id, lowStockThreshold: item.lowStockThreshold },
      `${label} now reports low stock at ${item.lowStockThreshold} or fewer.`,
    );
  });
}
