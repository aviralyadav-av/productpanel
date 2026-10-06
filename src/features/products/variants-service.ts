import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { diffOf, writeAudit } from "@/lib/audit";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { generateVariants, variantOptionKey, VariantError, type GenerateVariantsResult } from "@/features/catalog/variants";
import { ensureInventoryItem } from "@/features/inventory/service";

import {
  PRODUCT_ENTITY,
  deletedSuffix,
  ensureDefaultVariant,
  loadProduct,
  loadVariant,
  syncVariantAttributeRows,
  variantAxisAttributeIds,
  type Db,
} from "./internal";
import type { CreateVariantValues, UpdateVariantInput, VariantAxesInput } from "./schemas";
import type { ProductActor } from "./service";
import { recomputeProduct } from "./service";

/**
 * Variants (blueprint §14.A5, A8, F2).
 *
 * Generation is delegated to the shared catalog helper so the admin, the seed
 * and the REST route agree on optionKey/name rules; this file adds the manual
 * paths (one-off variants, inline edits, default, images, soft delete) and
 * the A8 bookkeeping that follows every variant write.
 */

const VARIANT_ENTITY = "variant";

function isP2002(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: string }).code === "P2002";
}

/** VariantError → ApiError so actions/routes report a sentence, not a stack. */
function rethrow(error: unknown): never {
  if (error instanceof VariantError) {
    throw badRequest(error.message, error.details as Record<string, string> | undefined);
  }
  if (isP2002(error)) throw conflict("That SKU or variant name is already in use.", { sku: "Already in use." });
  throw error;
}

async function afterVariantWrite(tx: Db, productId: string): Promise<void> {
  await syncVariantAttributeRows(tx, productId);
  await ensureDefaultVariant(tx, productId);
  await recomputeProduct(tx, productId);
}

// ---------------------------------------------------------------------------
// Generate (A5)
// ---------------------------------------------------------------------------

export async function generateProductVariants(
  productId: string,
  input: VariantAxesInput,
  actor: ProductActor,
  meta: { ip?: string | null } = {},
): Promise<GenerateVariantsResult> {
  const result = await db
    .$transaction(async (tx) => {
      const product = await loadProduct(tx, productId);
      const generated = await generateVariants(tx, {
        productId,
        axes: input.axes,
        actorId: actor.id === "system" ? null : actor.id,
      });
      await syncVariantAttributeRows(tx, productId);
      await recomputeProduct(tx, productId);
      await writeAudit(tx, {
        actor,
        action: "product.variants_generate",
        entityType: PRODUCT_ENTITY,
        entityId: productId,
        entityLabel: product.title,
        summary: `Generated variants for "${product.title}": ${generated.created} created, ${generated.kept} kept, ${generated.deactivated} deactivated.`,
        diff: diffOf(null, { axes: input.axes, ...generated }),
        ip: meta.ip,
      });
      return generated;
    })
    .catch(rethrow);

  await invalidatePublic(listTagsFor(VARIANT_ENTITY));
  return result;
}

// ---------------------------------------------------------------------------
// Manual CRUD
// ---------------------------------------------------------------------------

export type VariantRecord = Awaited<ReturnType<typeof loadVariant>>;

/**
 * A hand-made variant. When attribute values are given they must be variant
 * axes of the product's category (so the generator can later adopt the row by
 * optionKey); without them the variant is a free-form option like "Gift box".
 */
export async function createVariant(
  productId: string,
  input: CreateVariantValues,
  actor: ProductActor,
  meta: { ip?: string | null } = {},
): Promise<VariantRecord> {
  const result = await db
    .$transaction(async (tx) => {
      const product = await loadProduct(tx, productId);

      let optionKey: string | null = null;
      if (input.attributeValues.length > 0) {
        const axes = await variantAxisAttributeIds(tx, product.categoryId);
        const bad = input.attributeValues.find((pair) => !axes.has(pair.attributeId));
        if (bad) throw badRequest("Only variant attributes of the product's category can define a variant.");
        const values = await tx.attributeValue.findMany({
          where: { id: { in: input.attributeValues.map((pair) => pair.valueId) } },
          select: { id: true, attributeId: true },
        });
        for (const pair of input.attributeValues) {
          if (!values.some((value) => value.id === pair.valueId && value.attributeId === pair.attributeId)) {
            throw badRequest("One of the chosen values does not belong to its attribute.");
          }
        }
        optionKey = variantOptionKey(input.attributeValues);
        const clash = await tx.productVariant.findFirst({ where: { productId, optionKey }, select: { id: true, deletedAt: true } });
        if (clash) throw conflict("A variant with that combination already exists.");
      }

      const position = (await tx.productVariant.count({ where: { productId } })) + 1;
      const variant = await tx.productVariant.create({
        data: {
          productId,
          name: input.name,
          optionKey,
          sku: input.sku,
          barcode: input.barcode,
          pricePaise: input.pricePaise,
          salePricePaise: input.salePricePaise,
          costPaise: input.costPaise,
          weightGrams: input.weightGrams,
          position,
          isActive: input.isActive,
          attributeValues: { create: input.attributeValues.map((pair) => ({ attributeId: pair.attributeId, valueId: pair.valueId })) },
        },
        select: { id: true },
      });
      await ensureInventoryItem(tx, variant.id, { onHand: input.openingStock, actorId: actor.id === "system" ? null : actor.id });
      await afterVariantWrite(tx, productId);
      await writeAudit(tx, {
        actor,
        action: "product.variant_create",
        entityType: PRODUCT_ENTITY,
        entityId: productId,
        entityLabel: product.title,
        summary: `Added variant "${input.name}" to "${product.title}".`,
        diff: diffOf(null, { variantId: variant.id, name: input.name, sku: input.sku, openingStock: input.openingStock }),
        ip: meta.ip,
      });
      return loadVariant(tx, productId, variant.id);
    })
    .catch(rethrow);

  await invalidatePublic(listTagsFor(VARIANT_ENTITY));
  return result;
}

export async function updateVariant(
  productId: string,
  variantId: string,
  patch: UpdateVariantInput,
  actor: ProductActor,
  meta: { ip?: string | null } = {},
): Promise<VariantRecord> {
  const result = await db
    .$transaction(async (tx) => {
      const product = await loadProduct(tx, productId);
      const before = await loadVariant(tx, productId, variantId);

      const data: Prisma.ProductVariantUpdateInput = {};
      for (const key of ["name", "sku", "barcode", "pricePaise", "salePricePaise", "costPaise", "weightGrams", "isActive"] as const) {
        if (patch[key] !== undefined) (data as Record<string, unknown>)[key] = patch[key];
      }
      const effectivePrice = patch.pricePaise === undefined ? before.pricePaise : patch.pricePaise;
      const effectiveSale = patch.salePricePaise === undefined ? before.salePricePaise : patch.salePricePaise;
      const basePrice = effectivePrice ?? product.pricePaise;
      if (effectiveSale !== null && effectiveSale >= basePrice) {
        throw badRequest("The variant sale price must be lower than its price.", { salePricePaise: "Must be below the price." });
      }
      if (patch.isActive === false && before.isDefault) data.isDefault = false;

      await tx.productVariant.update({ where: { id: variantId }, data });
      await afterVariantWrite(tx, productId);
      const after = await loadVariant(tx, productId, variantId);
      await writeAudit(tx, {
        actor,
        action: "product.variant_update",
        entityType: PRODUCT_ENTITY,
        entityId: productId,
        entityLabel: product.title,
        summary: `Updated variant "${after.name}" of "${product.title}".`,
        diff: diffOf(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>),
        ip: meta.ip,
      });
      return after;
    })
    .catch(rethrow);

  await invalidatePublic(listTagsFor(VARIANT_ENTITY));
  return result;
}

/**
 * Variants are never hard-deleted: ensureInventoryItem writes a SEED movement
 * the moment one exists, and orders may reference it (F2). Soft delete hides
 * it everywhere, frees its SKU and drops it from facets.
 */
export async function deleteVariant(productId: string, variantId: string, actor: ProductActor, meta: { ip?: string | null } = {}) {
  const result = await db.$transaction(async (tx) => {
    const product = await loadProduct(tx, productId);
    const variant = await loadVariant(tx, productId, variantId);
    const live = await tx.productVariant.count({ where: { productId, deletedAt: null, id: { not: variantId } } });
    if (live === 0) throw badRequest("A product needs at least one variant. Deactivate it instead, or delete the product.");

    const now = new Date();
    await tx.productVariant.update({
      where: { id: variantId },
      data: {
        deletedAt: now,
        isActive: false,
        isDefault: false,
        sku: variant.sku ? deletedSuffix(variant.sku, now) : null,
        optionKey: variant.optionKey ? deletedSuffix(variant.optionKey, now) : null,
        name: deletedSuffix(variant.name, now),
      },
    });
    await afterVariantWrite(tx, productId);
    await writeAudit(tx, {
      actor,
      action: "product.variant_delete",
      entityType: PRODUCT_ENTITY,
      entityId: productId,
      entityLabel: product.title,
      summary: `Deleted variant "${variant.name}" from "${product.title}".`,
      diff: diffOf({ variantId, sku: variant.sku, deletedAt: null }, { variantId, sku: variant.sku, deletedAt: now.toISOString() }),
      ip: meta.ip,
    });
    return { id: variantId };
  });

  await invalidatePublic(listTagsFor(VARIANT_ENTITY));
  return result;
}

export async function setDefaultVariant(productId: string, variantId: string, actor: ProductActor, meta: { ip?: string | null } = {}) {
  const result = await db.$transaction(async (tx) => {
    const product = await loadProduct(tx, productId);
    const variant = await loadVariant(tx, productId, variantId);
    if (!variant.isActive) throw badRequest("Only an active variant can be the default.");
    await tx.productVariant.updateMany({ where: { productId, isDefault: true }, data: { isDefault: false } });
    await tx.productVariant.update({ where: { id: variantId }, data: { isDefault: true } });
    await writeAudit(tx, {
      actor,
      action: "product.variant_default",
      entityType: PRODUCT_ENTITY,
      entityId: productId,
      entityLabel: product.title,
      summary: `"${variant.name}" is now the default variant of "${product.title}".`,
      ip: meta.ip,
    });
    return { id: variantId };
  });
  await invalidatePublic(listTagsFor(VARIANT_ENTITY));
  return result;
}

/** Replace the images shown for one variant (a colourway's own photos). */
export async function setVariantImages(
  productId: string,
  variantId: string,
  mediaIds: readonly string[],
  actor: ProductActor,
  meta: { ip?: string | null } = {},
): Promise<{ count: number }> {
  const result = await db.$transaction(async (tx) => {
    const product = await loadProduct(tx, productId);
    const variant = await loadVariant(tx, productId, variantId);
    const unique = [...new Set(mediaIds)];
    const assets = await tx.mediaAsset.findMany({
      where: { id: { in: unique }, kind: "image", visibility: "PUBLIC" },
      select: { id: true, alt: true },
    });
    if (assets.length !== unique.length) throw notFound("One of the chosen images");
    const altOf = new Map(assets.map((asset) => [asset.id, asset.alt]));

    await tx.productImage.deleteMany({ where: { productId, variantId } });
    if (unique.length > 0) {
      await tx.productImage.createMany({
        data: unique.map((mediaId, index) => ({ productId, variantId, mediaId, alt: altOf.get(mediaId) ?? null, position: index, isPrimary: false })),
      });
    }
    await writeAudit(tx, {
      actor,
      action: "product.variant_images",
      entityType: PRODUCT_ENTITY,
      entityId: productId,
      entityLabel: product.title,
      summary: `Set ${unique.length} image${unique.length === 1 ? "" : "s"} on variant "${variant.name}".`,
      ip: meta.ip,
    });
    return { count: unique.length };
  });
  await invalidatePublic(listTagsFor(VARIANT_ENTITY));
  return result;
}

