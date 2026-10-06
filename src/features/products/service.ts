import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import type { ProductStatus } from "@/lib/enums";
import { createPreviewToken } from "@/lib/preview-token";
import { sanitizeHtml } from "@/lib/sanitize/html";
import { recomputeProductFacets } from "@/features/catalog/facets";
import {
  categoryChangeReport,
  validateProductForPublish,
  type CategoryChangeReport,
  type PublishProblem,
} from "@/features/catalog/publish-validation";
import { ensureInventoryItem } from "@/features/inventory/service";
import { readSettingString } from "@/features/finance/settings-reader";
import { STOREFRONT_PATHS } from "@/features/storefront/links";

import {
  PRODUCT_CORE_SELECT,
  PRODUCT_ENTITY,
  recomputeProduct,
  deletedSuffix,
  loadProduct,
  removeAttributeValues,
  resolveProductSlug,
  syncTags,
  syncVariantAttributeRows,
  upsertAttributeValues,
  type Db,
  type ProductCore,
} from "./internal";
import type { AttributeValueInput, FlagsInput, ProductFormValues } from "./schemas";

/**
 * Product business logic (blueprint §1 Products, §11.5/6/23/34, §14.A3-A8).
 *
 * Every function: load → validate → write inside ONE transaction → audit
 * (inside the tx, so a failed audit aborts the change) → recompute the
 * denormalised columns (facets, pricing) → return. Cache invalidation for the
 * storefront runs after commit. Server Actions and REST handlers are thin
 * wrappers; nothing here imports `server-only` or `next/*`.
 *
 * Variants, images, customisation options and bulk operations live in their
 * own files next to this one and share ./internal.ts.
 */

export type { CategoryChangeReport, PublishProblem };

export type ProductActor = AuditActor;

export { recomputeProduct };
export { duplicateProduct } from "./duplicate-service";


/** The columns worth diffing in the audit row (timestamps and the JSON blob add noise, not signal). */
function auditView(product: ProductCore): Record<string, unknown> {
  const { updatedAt, createdAt, customFields, ...rest } = product;
  void updatedAt;
  void createdAt;
  return { ...rest, customFieldCount: Object.keys((customFields as Record<string, unknown>) ?? {}).length };
}

/** Ordinary product columns from the form (relations handled separately). */
function scalarData(input: Partial<ProductFormValues>): Prisma.ProductUncheckedUpdateInput {
  const data: Prisma.ProductUncheckedUpdateInput = {};
  const copy = <K extends keyof ProductFormValues & keyof Prisma.ProductUncheckedUpdateInput>(key: K) => {
    if (input[key] !== undefined) (data as Record<string, unknown>)[key] = input[key];
  };
  (
    [
      "title",
      "baseSku",
      "shortDescription",
      "categoryId",
      "sellerId",
      "brand",
      "pricePaise",
      "salePricePaise",
      "saleStartsAt",
      "saleEndsAt",
      "costPaise",
      "taxRateBps",
      "hsnCode",
      "weightGrams",
      "lengthMm",
      "widthMm",
      "heightMm",
      "shippingNote",
      "isFeatured",
      "isNewArrival",
      "isBestseller",
      "isTrending",
      "minOrderQty",
      "maxOrderQty",
      "position",
      "videoUrl",
      "videoMediaId",
      "metaTitle",
      "metaDescription",
      "canonicalUrl",
      "ogImageMediaId",
    ] as const
  ).forEach(copy);

  if (input.description !== undefined) data.description = sanitizeHtml(input.description, "rich");
  if (input.metaKeywords !== undefined) data.metaKeywords = input.metaKeywords.length > 0 ? input.metaKeywords.join(", ") : null;
  if (input.customFields !== undefined) data.customFields = input.customFields as Prisma.InputJsonValue;
  return data;
}

async function assertReferences(tx: Db, input: Partial<ProductFormValues>): Promise<void> {
  if (input.categoryId) {
    const category = await tx.category.findUnique({ where: { id: input.categoryId }, select: { id: true } });
    if (!category) throw badRequest("That category no longer exists.", { categoryId: "Unknown category." });
  }
  if (input.sellerId) {
    const seller = await tx.seller.findUnique({ where: { id: input.sellerId }, select: { id: true, deletedAt: true } });
    if (!seller || seller.deletedAt) throw badRequest("That seller no longer exists.", { sellerId: "Unknown seller." });
  }
  for (const key of ["videoMediaId", "ogImageMediaId"] as const) {
    const id = input[key];
    if (!id) continue;
    const media = await tx.mediaAsset.findUnique({ where: { id }, select: { id: true } });
    if (!media) throw badRequest("That media file no longer exists.", { [key]: "Unknown media." });
  }
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export type CreateProductResult = { id: string; slug: string };

/**
 * New products are DRAFTs with one "Default" variant (+ InventoryItem) so a
 * simple product is sellable without visiting the variants section; the
 * generator deactivates that placeholder when real axes are generated.
 */
export async function createProduct(
  input: ProductFormValues,
  actor: ProductActor,
  meta: { ip?: string | null } = {},
): Promise<CreateProductResult> {
  const result = await db.$transaction(async (tx) => {
    await assertReferences(tx, input);
    const { slug } = await resolveProductSlug(tx, input.slug, { autoSuffix: true });

    const product = await tx.product.create({
      data: {
        ...(scalarData(input) as Prisma.ProductUncheckedCreateInput),
        title: input.title,
        slug,
        pricePaise: input.pricePaise,
        description: sanitizeHtml(input.description ?? "", "rich"),
        status: "DRAFT",
        createdById: actor.id === "system" ? null : actor.id,
      },
      select: { id: true, slug: true, title: true },
    });

    await syncTags(tx, product.id, input.tags ?? []);
    if (input.attributeValues?.length) await upsertAttributeValues(tx, product.id, input.attributeValues, { replace: true });

    const variant = await tx.productVariant.create({
      data: { productId: product.id, name: "Default", position: 0, isActive: true, isDefault: true },
      select: { id: true },
    });
    await ensureInventoryItem(tx, variant.id, { actorId: actor.id === "system" ? null : actor.id });

    await recomputeProduct(tx, product.id);
    await writeAudit(tx, {
      actor,
      action: "product.create",
      entityType: PRODUCT_ENTITY,
      entityId: product.id,
      entityLabel: product.title,
      summary: `Created product "${product.title}" (${product.slug}).`,
      diff: diffOf(null, { title: product.title, slug: product.slug, categoryId: input.categoryId, pricePaise: input.pricePaise }),
      ip: meta.ip,
    });
    return { id: product.id, slug: product.slug };
  });

  await invalidatePublic(listTagsFor(PRODUCT_ENTITY));
  return result;
}

export type UpdateProductResult = {
  product: ProductCore;
  /** Present when the category changed (A6); the editor shows it after save. */
  categoryChange: CategoryChangeReport | null;
};

export async function updateProduct(
  id: string,
  input: Partial<ProductFormValues>,
  actor: ProductActor,
  meta: { ip?: string | null } = {},
): Promise<UpdateProductResult> {
  const result = await db.$transaction(async (tx) => {
    const before = await loadProduct(tx, id);
    await assertReferences(tx, input);

    let slug = before.slug;
    if (input.slug !== undefined && input.slug !== before.slug) {
      const resolved = await resolveProductSlug(tx, input.slug, { exceptId: id, autoSuffix: false });
      if (resolved.taken) throw conflict("That slug is already used by another product.", { slug: "Already in use." });
      slug = resolved.slug;
    }

    const categoryChanged = input.categoryId !== undefined && input.categoryId !== before.categoryId;
    const report = categoryChanged
      ? await categoryChangeReport(tx, { productId: id, newCategoryId: input.categoryId ?? null })
      : null;

    const after = await tx.product.update({
      where: { id },
      data: { ...scalarData(input), slug },
      select: PRODUCT_CORE_SELECT,
    });

    if (input.tags !== undefined) await syncTags(tx, id, input.tags);
    if (input.attributeValues !== undefined) await upsertAttributeValues(tx, id, input.attributeValues, { replace: true });

    await recomputeProduct(tx, id);

    await writeAudit(tx, {
      actor,
      action: "product.update",
      entityType: PRODUCT_ENTITY,
      entityId: id,
      entityLabel: after.title,
      summary: `Updated product "${after.title}".`,
      diff: diffOf(auditView(before), auditView(after)),
      ip: meta.ip,
    });

    return { product: after, categoryChange: report };
  });

  await invalidatePublic(listTagsFor(PRODUCT_ENTITY));
  return result;
}

// ---------------------------------------------------------------------------
// Status (§11.5)
// ---------------------------------------------------------------------------

export type SetStatusResult =
  | { ok: true; product: ProductCore }
  | { ok: false; problems: PublishProblem[] };

/**
 * PUBLISHED is gated by validateProductForPublish; DRAFT and ARCHIVED are
 * always allowed. `publishedAt` is set on the first publish only so "new"
 * badges and sort-by-newest stay stable across unpublish/republish.
 */
export async function setProductStatus(
  id: string,
  status: ProductStatus,
  actor: ProductActor,
  meta: { ip?: string | null; reason?: string | null } = {},
): Promise<SetStatusResult> {
  const result = await db.$transaction(async (tx): Promise<SetStatusResult> => {
    const before = await loadProduct(tx, id);
    if (status === "PUBLISHED") {
      const validation = await validateProductForPublish(tx, id);
      if (!validation.ok) return { ok: false, problems: validation.problems };
    }
    if (before.status === status) return { ok: true, product: before };

    const after = await tx.product.update({
      where: { id },
      data: {
        status,
        publishedAt: status === "PUBLISHED" && !before.publishedAt ? new Date() : undefined,
      },
      select: PRODUCT_CORE_SELECT,
    });
    await writeAudit(tx, {
      actor,
      action: "product.status_change",
      entityType: PRODUCT_ENTITY,
      entityId: id,
      entityLabel: after.title,
      summary: `${after.title}: ${before.status} → ${status}${meta.reason ? ` (${meta.reason})` : ""}.`,
      diff: diffOf({ status: before.status }, { status }),
      ip: meta.ip,
    });
    return { ok: true, product: after };
  });

  if (result.ok) await invalidatePublic(listTagsFor(PRODUCT_ENTITY));
  return result;
}

export async function publishValidation(id: string): Promise<{ ok: boolean; problems: PublishProblem[] }> {
  return validateProductForPublish(undefined, id);
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

export async function setProductFlags(id: string, flags: FlagsInput, actor: ProductActor, meta: { ip?: string | null } = {}) {
  const result = await db.$transaction(async (tx) => {
    const before = await loadProduct(tx, id);
    const data: Prisma.ProductUpdateInput = {};
    for (const key of ["isFeatured", "isNewArrival", "isBestseller", "isTrending"] as const) {
      if (flags[key] !== undefined) data[key] = flags[key];
    }
    const after = await tx.product.update({ where: { id }, data, select: PRODUCT_CORE_SELECT });
    await writeAudit(tx, {
      actor,
      action: "product.flags",
      entityType: PRODUCT_ENTITY,
      entityId: id,
      entityLabel: after.title,
      summary: `Updated flags on "${after.title}".`,
      diff: diffOf(
        { isFeatured: before.isFeatured, isNewArrival: before.isNewArrival, isBestseller: before.isBestseller, isTrending: before.isTrending },
        { isFeatured: after.isFeatured, isNewArrival: after.isNewArrival, isBestseller: after.isBestseller, isTrending: after.isTrending },
      ),
      ip: meta.ip,
    });
    return after;
  });
  await invalidatePublic(listTagsFor(PRODUCT_ENTITY));
  return result;
}

// ---------------------------------------------------------------------------
// Attribute values (A6, A8)
// ---------------------------------------------------------------------------

export async function setProductAttributeValues(
  id: string,
  values: readonly AttributeValueInput[],
  actor: ProductActor,
  options: { replace?: boolean; ip?: string | null } = {},
) {
  const result = await db.$transaction(async (tx) => {
    const product = await loadProduct(tx, id);
    const written = await upsertAttributeValues(tx, id, values, { replace: options.replace ?? true });
    await recomputeProduct(tx, id);
    await writeAudit(tx, {
      actor,
      action: "product.attribute_values",
      entityType: PRODUCT_ENTITY,
      entityId: id,
      entityLabel: product.title,
      summary: `Set ${written.written} attribute value${written.written === 1 ? "" : "s"} on "${product.title}".`,
      ip: options.ip,
    });
    return written;
  });
  await invalidatePublic(listTagsFor(PRODUCT_ENTITY));
  return result;
}

export async function removeProductAttribute(id: string, attributeId: string, actor: ProductActor, meta: { ip?: string | null } = {}) {
  const result = await db.$transaction(async (tx) => {
    const product = await loadProduct(tx, id);
    const attribute = await tx.attribute.findUnique({ where: { id: attributeId }, select: { name: true } });
    const removed = await removeAttributeValues(tx, id, attributeId);
    await recomputeProduct(tx, id);
    await writeAudit(tx, {
      actor,
      action: "product.attribute_values",
      entityType: PRODUCT_ENTITY,
      entityId: id,
      entityLabel: product.title,
      summary: `Removed ${attribute?.name ?? attributeId} (${removed} value${removed === 1 ? "" : "s"}) from "${product.title}".`,
      ip: meta.ip,
    });
    return { removed };
  });
  await invalidatePublic(listTagsFor(PRODUCT_ENTITY));
  return result;
}

// ---------------------------------------------------------------------------
// Delete (§11.34)
// ---------------------------------------------------------------------------

/**
 * Soft delete: order lines keep pointing at the product, the slug is freed by
 * suffixing, variants are deactivated (never deleted - orders and the stock
 * ledger reference them) and the row is hidden from every admin list.
 */
export async function softDeleteProduct(
  id: string,
  actor: ProductActor,
  meta: { ip?: string | null; reason?: string | null } = {},
): Promise<{ id: string; slug: string }> {
  const result = await db.$transaction(async (tx) => {
    const before = await loadProduct(tx, id);
    const now = new Date();
    const after = await tx.product.update({
      where: { id },
      data: { deletedAt: now, status: "ARCHIVED", slug: deletedSuffix(before.slug, now) },
      select: { id: true, slug: true, title: true },
    });
    await tx.productVariant.updateMany({ where: { productId: id }, data: { isActive: false } });
    await syncVariantAttributeRows(tx, id);
    await recomputeProductFacets(tx, id);
    await writeAudit(tx, {
      actor,
      action: "product.delete",
      entityType: PRODUCT_ENTITY,
      entityId: id,
      entityLabel: before.title,
      summary: `Deleted product "${before.title}"${meta.reason ? ` - ${meta.reason}` : ""}.`,
      diff: diffOf({ slug: before.slug, status: before.status, deletedAt: null }, { slug: after.slug, status: "ARCHIVED", deletedAt: now.toISOString() }),
      ip: meta.ip,
    });
    return { id: after.id, slug: after.slug };
  });

  await invalidatePublic(listTagsFor(PRODUCT_ENTITY));
  return result;
}

// ---------------------------------------------------------------------------
// Preview (E6)
// ---------------------------------------------------------------------------

export type PreviewLink = { token: string; expiresAt: Date; url: string };

/** `${storefront.base_url}/p/<slug>?preview=<token>`; the website verifies the token via GET /api/v1/products/:slug. */
export async function createProductPreviewLink(id: string, ttlSeconds?: number): Promise<PreviewLink> {
  const product = await db.product.findUnique({ where: { id }, select: { slug: true, deletedAt: true } });
  if (!product || product.deletedAt) throw notFound("Product");
  const { token, expiresAt } = createPreviewToken({ entity: "product", id, ttlSeconds });
  const base = (await readSettingString(undefined, "storefront.base_url")).replace(/\/+$/, "");
  return { token, expiresAt, url: `${base}${STOREFRONT_PATHS.product(product.slug)}?preview=${encodeURIComponent(token)}` };
}
