import { db } from "@/lib/db";
import { badRequest, notFound } from "@/lib/api/errors";
import { diffOf, writeAudit } from "@/lib/audit";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { PRODUCT_ENTITY, loadProduct, loadVariant, type Db } from "./internal";
import type { UpdateImageInput } from "./schemas";
import type { ProductActor } from "./service";

/**
 * Product gallery (blueprint §1 Products, §11.5, §11.22).
 *
 * Images reference MediaAsset rows by id - never by URL - so replacing a file
 * in the media library updates every product at once and the "asset in use"
 * check can refuse a delete. The gallery is the rows with `variantId = null`;
 * per-variant rows are managed by variants-service.setVariantImages.
 */

const GALLERY = (productId: string) => ({ productId, variantId: null });

/** Keep positions dense (0..n-1) and exactly one primary, first row by default. */
async function normaliseGallery(tx: Db, productId: string): Promise<void> {
  const rows = await tx.productImage.findMany({
    where: GALLERY(productId),
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, position: true, isPrimary: true },
  });
  const primaryIndex = Math.max(0, rows.findIndex((row) => row.isPrimary));
  for (const [index, row] of rows.entries()) {
    const isPrimary = index === primaryIndex;
    if (row.position !== index || row.isPrimary !== isPrimary) {
      await tx.productImage.update({ where: { id: row.id }, data: { position: index, isPrimary } });
    }
  }
}

async function loadImage(tx: Db, productId: string, imageId: string) {
  const image = await tx.productImage.findUnique({
    where: { id: imageId },
    select: { id: true, productId: true, variantId: true, mediaId: true, alt: true, position: true, isPrimary: true, media: { select: { filename: true } } },
  });
  if (!image || image.productId !== productId) throw notFound("Image");
  return image;
}

export async function addProductImages(
  productId: string,
  mediaIds: readonly string[],
  actor: ProductActor,
  options: { variantId?: string | null; ip?: string | null } = {},
): Promise<{ added: number; skipped: number }> {
  const result = await db.$transaction(async (tx) => {
    const product = await loadProduct(tx, productId);
    if (options.variantId) await loadVariant(tx, productId, options.variantId);

    const unique = [...new Set(mediaIds)];
    const assets = await tx.mediaAsset.findMany({
      where: { id: { in: unique }, kind: "image" },
      select: { id: true, alt: true, visibility: true },
    });
    if (assets.length !== unique.length) throw notFound("One of the chosen images");
    if (assets.some((asset) => asset.visibility !== "PUBLIC")) {
      throw badRequest("Private files cannot be shown on the storefront. Pick a public image.");
    }

    const scope = options.variantId ? { productId, variantId: options.variantId } : GALLERY(productId);
    const existing = await tx.productImage.findMany({ where: scope, select: { mediaId: true, position: true } });
    const already = new Set(existing.map((row) => row.mediaId));
    let position = existing.reduce((max, row) => Math.max(max, row.position), -1) + 1;
    const altOf = new Map(assets.map((asset) => [asset.id, asset.alt]));

    const fresh = unique.filter((id) => !already.has(id));
    if (fresh.length > 0) {
      await tx.productImage.createMany({
        data: fresh.map((mediaId) => ({
          productId,
          variantId: options.variantId ?? null,
          mediaId,
          alt: altOf.get(mediaId) ?? null,
          position: position++,
          isPrimary: false,
        })),
      });
    }
    if (!options.variantId) await normaliseGallery(tx, productId);

    await writeAudit(tx, {
      actor,
      action: "product.images_add",
      entityType: PRODUCT_ENTITY,
      entityId: productId,
      entityLabel: product.title,
      summary: `Added ${fresh.length} image${fresh.length === 1 ? "" : "s"} to "${product.title}".`,
      diff: diffOf(null, { mediaIds: fresh, variantId: options.variantId ?? null }),
      ip: options.ip,
    });
    return { added: fresh.length, skipped: unique.length - fresh.length };
  });
  await invalidatePublic(listTagsFor(PRODUCT_ENTITY));
  return result;
}

export async function updateProductImage(
  productId: string,
  imageId: string,
  patch: UpdateImageInput,
  actor: ProductActor,
  meta: { ip?: string | null } = {},
) {
  const result = await db.$transaction(async (tx) => {
    const product = await loadProduct(tx, productId);
    const before = await loadImage(tx, productId, imageId);
    if (patch.variantId) await loadVariant(tx, productId, patch.variantId);

    if (patch.isPrimary === true) {
      await tx.productImage.updateMany({ where: { ...GALLERY(productId), id: { not: imageId } }, data: { isPrimary: false } });
    }
    const after = await tx.productImage.update({
      where: { id: imageId },
      data: {
        alt: patch.alt === undefined ? undefined : patch.alt,
        isPrimary: patch.isPrimary,
        variantId: patch.variantId === undefined ? undefined : patch.variantId,
      },
      select: { id: true, alt: true, isPrimary: true, variantId: true, position: true },
    });
    await normaliseGallery(tx, productId);
    await writeAudit(tx, {
      actor,
      action: "product.image_update",
      entityType: PRODUCT_ENTITY,
      entityId: productId,
      entityLabel: product.title,
      summary: `Updated image "${before.media.filename}" on "${product.title}".`,
      diff: diffOf(
        { alt: before.alt, isPrimary: before.isPrimary, variantId: before.variantId },
        { alt: after.alt, isPrimary: after.isPrimary, variantId: after.variantId },
      ),
      ip: meta.ip,
    });
    return after;
  });
  await invalidatePublic(listTagsFor(PRODUCT_ENTITY));
  return result;
}

export async function removeProductImage(productId: string, imageId: string, actor: ProductActor, meta: { ip?: string | null } = {}) {
  const result = await db.$transaction(async (tx) => {
    const product = await loadProduct(tx, productId);
    const image = await loadImage(tx, productId, imageId);
    await tx.productImage.delete({ where: { id: imageId } });
    await normaliseGallery(tx, productId);
    await writeAudit(tx, {
      actor,
      action: "product.image_remove",
      entityType: PRODUCT_ENTITY,
      entityId: productId,
      entityLabel: product.title,
      summary: `Removed image "${image.media.filename}" from "${product.title}".`,
      diff: diffOf({ mediaId: image.mediaId }, null),
      ip: meta.ip,
    });
    return { id: imageId };
  });
  await invalidatePublic(listTagsFor(PRODUCT_ENTITY));
  return result;
}

/** `orderedIds` is the full gallery in its new order; anything missing keeps its relative order after them. */
export async function reorderProductImages(productId: string, orderedIds: readonly string[], actor: ProductActor, meta: { ip?: string | null } = {}) {
  const result = await db.$transaction(async (tx) => {
    const product = await loadProduct(tx, productId);
    const rows = await tx.productImage.findMany({
      where: GALLERY(productId),
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const known = new Set(rows.map((row) => row.id));
    const ordered = [...new Set(orderedIds)].filter((id) => known.has(id));
    const rest = rows.map((row) => row.id).filter((id) => !ordered.includes(id));
    const final = [...ordered, ...rest];
    for (const [index, id] of final.entries()) {
      await tx.productImage.update({ where: { id }, data: { position: index } });
    }
    await normaliseGallery(tx, productId);
    await writeAudit(tx, {
      actor,
      action: "product.images_reorder",
      entityType: PRODUCT_ENTITY,
      entityId: productId,
      entityLabel: product.title,
      summary: `Reordered the gallery of "${product.title}".`,
      ip: meta.ip,
    });
    return { count: final.length };
  });
  await invalidatePublic(listTagsFor(PRODUCT_ENTITY));
  return result;
}
