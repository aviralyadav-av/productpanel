import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { badRequest } from "@/lib/api/errors";
import { writeAudit } from "@/lib/audit";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { validateProductForPublish } from "@/features/catalog/publish-validation";
import { recomputeProductFacets } from "@/features/catalog/facets";
import { recomputeProductPricing } from "@/features/catalog/pricing";
import { afterStockChange, applyStockMovement, InventoryError, type StockChange } from "@/features/inventory/service";

import { PRODUCT_ENTITY, deletedSuffix, syncVariantAttributeRows, upsertAttributeValues } from "./internal";
import { BULK_MAX_IDS, type BulkRequest } from "./schemas";
import type { ProductActor } from "./service";

/**
 * Bulk operations (blueprint §14.A7, §11.33, D13).
 *
 * One transaction for the whole batch: either every selected product changes
 * or none does, and the operator gets ONE summary toast instead of 500. Rows
 * that cannot take the operation (a draft that fails publish validation, a
 * product with no variant to stock) are skipped with a reason rather than
 * aborting the batch - a skipped row is visible, a rolled-back batch is not.
 *
 * The caller checks `products.bulk` plus the op's own permission
 * (BULK_OP_PERMISSION in ./schemas) before calling.
 */

export type BulkSkip = { id: string; title: string | null; reason: string };

export type BulkResult = {
  op: BulkRequest["op"];
  requested: number;
  affected: number;
  skipped: BulkSkip[];
  /** One sentence for the toast. */
  summary: string;
};

type Row = {
  id: string;
  title: string;
  status: string;
  pricePaise: number;
  salePricePaise: number | null;
  categoryId: string | null;
  variants: Array<{ id: string; isDefault: boolean; isActive: boolean; position: number; pricePaise: number | null; salePricePaise: number | null }>;
};

const ROW_SELECT = {
  id: true,
  title: true,
  status: true,
  pricePaise: true,
  salePricePaise: true,
  categoryId: true,
  variants: {
    where: { deletedAt: null },
    orderBy: { position: "asc" },
    select: { id: true, isDefault: true, isActive: true, position: true, pricePaise: true, salePricePaise: true },
  },
} satisfies Prisma.ProductSelect;

/** ADJUST_PRICE arithmetic, shared by product and variant prices. */
export function adjustedPrice(current: number, mode: "PERCENT" | "FIXED" | "SET", value: number): number {
  const next =
    mode === "PERCENT" ? Math.round(current * (1 + value / 100)) : mode === "FIXED" ? current + Math.round(value) : Math.round(value);
  return Math.max(1, next);
}

function pickStockVariant(row: Row) {
  return row.variants.find((variant) => variant.isDefault && variant.isActive) ?? row.variants.find((variant) => variant.isActive) ?? null;
}

export async function bulkProducts(
  input: BulkRequest,
  actor: ProductActor,
  meta: { ip?: string | null } = {},
): Promise<BulkResult> {
  const ids = [...new Set(input.ids)];
  if (ids.length > BULK_MAX_IDS) throw badRequest(`At most ${BULK_MAX_IDS} products per bulk action.`);

  const stockChanges: StockChange[] = [];

  const result = await db.$transaction(
    async (tx) => {
      const rows: Row[] = await tx.product.findMany({ where: { id: { in: ids }, deletedAt: null }, select: ROW_SELECT });
      const found = new Set(rows.map((row) => row.id));
      const skipped: BulkSkip[] = ids.filter((id) => !found.has(id)).map((id) => ({ id, title: null, reason: "Not found." }));
      const affectedIds: string[] = [];
      let recomputeFacets = false;
      let recomputePricing = false;

      if (input.op === "SET_CATEGORY") {
        const category = await tx.category.findUnique({ where: { id: input.categoryId }, select: { id: true, name: true } });
        if (!category) throw badRequest("That category does not exist.", { categoryId: "Unknown category." });
      }
      if (input.op === "SET_ATTRIBUTE") {
        const attribute = await tx.attribute.findUnique({ where: { id: input.attributeId }, select: { id: true } });
        if (!attribute) throw badRequest("That attribute does not exist.", { attributeId: "Unknown attribute." });
      }

      for (const row of rows) {
        switch (input.op) {
          case "PUBLISH": {
            const validation = await validateProductForPublish(tx, row.id);
            if (!validation.ok) {
              skipped.push({ id: row.id, title: row.title, reason: validation.problems.map((problem) => problem.message).join(" ") });
              break;
            }
            if (row.status !== "PUBLISHED") {
              await tx.product.update({ where: { id: row.id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
            }
            affectedIds.push(row.id);
            break;
          }
          case "UNPUBLISH":
            await tx.product.update({ where: { id: row.id }, data: { status: "DRAFT" } });
            affectedIds.push(row.id);
            break;
          case "ARCHIVE":
            await tx.product.update({ where: { id: row.id }, data: { status: "ARCHIVED" } });
            affectedIds.push(row.id);
            break;
          case "DELETE": {
            const now = new Date();
            const current = await tx.product.findUnique({ where: { id: row.id }, select: { slug: true } });
            await tx.product.update({
              where: { id: row.id },
              data: { deletedAt: now, status: "ARCHIVED", slug: deletedSuffix(current?.slug ?? row.id, now) },
            });
            await tx.productVariant.updateMany({ where: { productId: row.id }, data: { isActive: false } });
            await syncVariantAttributeRows(tx, row.id);
            recomputeFacets = true;
            affectedIds.push(row.id);
            break;
          }
          case "SET_CATEGORY":
            await tx.product.update({ where: { id: row.id }, data: { categoryId: input.categoryId } });
            recomputeFacets = true;
            recomputePricing = true;
            affectedIds.push(row.id);
            break;
          case "ADJUST_PRICE": {
            const price = adjustedPrice(row.pricePaise, input.mode, input.value);
            // A sale price that is no longer below the new price is dropped rather
            // than left inverted (§11.6).
            const sale = row.salePricePaise !== null && row.salePricePaise < price ? row.salePricePaise : null;
            await tx.product.update({ where: { id: row.id }, data: { pricePaise: price, salePricePaise: sale } });
            for (const variant of row.variants) {
              if (variant.pricePaise === null) continue;
              const variantPrice = adjustedPrice(variant.pricePaise, input.mode, input.value);
              const variantSale = variant.salePricePaise !== null && variant.salePricePaise < variantPrice ? variant.salePricePaise : null;
              await tx.productVariant.update({ where: { id: variant.id }, data: { pricePaise: variantPrice, salePricePaise: variantSale } });
            }
            recomputePricing = true;
            affectedIds.push(row.id);
            break;
          }
          case "SET_STOCK": {
            const variant = pickStockVariant(row);
            if (!variant) {
              skipped.push({ id: row.id, title: row.title, reason: "No active variant to stock." });
              break;
            }
            const item = await tx.inventoryItem.findUnique({ where: { variantId: variant.id }, select: { onHand: true } });
            const delta = input.onHand - (item?.onHand ?? 0);
            if (delta !== 0) {
              try {
                const change = await applyStockMovement(tx, {
                  variantId: variant.id,
                  delta,
                  type: "ADJUSTMENT",
                  reason: input.reason,
                  note: "Bulk set stock",
                  actorId: actor.id === "system" ? null : actor.id,
                });
                stockChanges.push(change);
              } catch (error) {
                if (error instanceof InventoryError) {
                  skipped.push({ id: row.id, title: row.title, reason: error.message });
                  break;
                }
                throw error;
              }
            }
            recomputeFacets = true;
            affectedIds.push(row.id);
            break;
          }
          case "SET_ATTRIBUTE": {
            if (input.mode === "remove") {
              await tx.productAttributeValue.deleteMany({
                where: {
                  productId: row.id,
                  attributeId: input.attributeId,
                  fromVariants: false,
                  ...(input.valueId ? { valueId: input.valueId } : {}),
                },
              });
            } else {
              if (input.mode === "add" && input.valueId) {
                // "add" keeps the other selected values (MULTI_SELECT); "set" replaces them.
                const existing = await tx.productAttributeValue.findMany({
                  where: { productId: row.id, attributeId: input.attributeId, fromVariants: false, valueId: { not: null } },
                  select: { valueId: true },
                });
                const valueIds = [...new Set([...existing.map((item) => item.valueId as string), input.valueId])];
                await upsertAttributeValues(tx, row.id, [{ attributeId: input.attributeId, valueIds }], { replace: false });
              } else {
                await upsertAttributeValues(
                  tx,
                  row.id,
                  [
                    {
                      attributeId: input.attributeId,
                      valueIds: input.valueId ? [input.valueId] : undefined,
                      textValue: input.textValue,
                      numberValue: input.numberValue,
                      boolValue: input.boolValue,
                    },
                  ],
                  { replace: false },
                );
              }
            }
            recomputeFacets = true;
            affectedIds.push(row.id);
            break;
          }
          case "SET_FLAGS": {
            const data: Prisma.ProductUpdateInput = {};
            for (const key of ["isFeatured", "isNewArrival", "isBestseller", "isTrending"] as const) {
              if (input[key] !== undefined) data[key] = input[key];
            }
            await tx.product.update({ where: { id: row.id }, data });
            affectedIds.push(row.id);
            break;
          }
        }
      }

      if (recomputeFacets) for (const id of affectedIds) await recomputeProductFacets(tx, id);
      if (recomputePricing && affectedIds.length > 0) await recomputeProductPricing(tx, { productIds: affectedIds });

      const summary = describe(input, affectedIds.length, skipped.length);
      await writeAudit(tx, {
        actor,
        action: `product.bulk_${input.op.toLowerCase()}`,
        entityType: PRODUCT_ENTITY,
        entityId: null,
        summary: `Bulk ${input.op}: ${affectedIds.length} of ${ids.length} product(s) changed.`,
        diff: { op: input.op, requested: ids.length, affected: affectedIds.length, skipped: skipped.length } as Prisma.InputJsonValue,
        ip: meta.ip,
      });

      return { op: input.op, requested: ids.length, affected: affectedIds.length, skipped, summary } satisfies BulkResult;
    },
    { timeout: 60_000 },
  );

  // Stock notifications/facet side effects must run after commit (F7).
  for (const change of stockChanges) {
    await afterStockChange(change.variantId, change);
  }
  await invalidatePublic(listTagsFor(PRODUCT_ENTITY));
  return result;
}

function describe(input: BulkRequest, affected: number, skipped: number): string {
  const noun = `${affected} product${affected === 1 ? "" : "s"}`;
  const tail = skipped > 0 ? ` ${skipped} skipped.` : "";
  switch (input.op) {
    case "PUBLISH":
      return `Published ${noun}.${tail}`;
    case "UNPUBLISH":
      return `Unpublished ${noun}.${tail}`;
    case "ARCHIVE":
      return `Archived ${noun}.${tail}`;
    case "DELETE":
      return `Deleted ${noun}.${tail}`;
    case "SET_CATEGORY":
      return `Moved ${noun} to the new category.${tail}`;
    case "ADJUST_PRICE":
      return `Adjusted prices on ${noun}.${tail}`;
    case "SET_STOCK":
      return `Set stock to ${input.onHand} on ${noun}.${tail}`;
    case "SET_ATTRIBUTE":
      return `Updated the attribute on ${noun}.${tail}`;
    case "SET_FLAGS":
      return `Updated flags on ${noun}.${tail}`;
  }
}
