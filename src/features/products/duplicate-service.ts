import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { notFound } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { ensureInventoryItem } from "@/features/inventory/service";

import { PRODUCT_ENTITY, ensureDefaultVariant, recomputeProduct, resolveProductSlug, syncCustomizableFlag } from "./internal";

/**
 * Product duplication, split from service.ts only for file length; it follows
 * the same tx → audit → recompute → invalidate shape.
 */

type ProductActor = AuditActor;
type CreateProductResult = { id: string; slug: string };

/**
 * A DRAFT copy with everything an operator would otherwise re-type: values,
 * variants (fresh inventory rows at zero, SKUs dropped because they are
 * unique), gallery, customisation options and tags. Counters and publish
 * state start from zero.
 */
export async function duplicateProduct(id: string, actor: ProductActor, meta: { ip?: string | null } = {}): Promise<CreateProductResult> {
  const result = await db.$transaction(async (tx) => {
    const source = await tx.product.findUnique({
      where: { id },
      include: {
        tags: { select: { id: true } },
        attributeValues: true,
        variants: { where: { deletedAt: null }, include: { attributeValues: true, images: true } },
        images: { where: { variantId: null } },
        customizationOptions: true,
      },
    });
    if (!source || source.deletedAt) throw notFound("Product");

    const { slug } = await resolveProductSlug(tx, `${source.slug}-copy`, { autoSuffix: true });
    const created = await tx.product.create({
      data: {
        slug,
        baseSku: source.baseSku,
        title: `${source.title} (Copy)`,
        shortDescription: source.shortDescription,
        description: source.description,
        categoryId: source.categoryId,
        sellerId: source.sellerId,
        brand: source.brand,
        status: "DRAFT",
        pricePaise: source.pricePaise,
        salePricePaise: source.salePricePaise,
        saleStartsAt: source.saleStartsAt,
        saleEndsAt: source.saleEndsAt,
        costPaise: source.costPaise,
        taxRateBps: source.taxRateBps,
        hsnCode: source.hsnCode,
        weightGrams: source.weightGrams,
        lengthMm: source.lengthMm,
        widthMm: source.widthMm,
        heightMm: source.heightMm,
        shippingNote: source.shippingNote,
        isFeatured: false,
        isNewArrival: source.isNewArrival,
        isBestseller: false,
        isTrending: false,
        isCustomizable: source.isCustomizable,
        minOrderQty: source.minOrderQty,
        maxOrderQty: source.maxOrderQty,
        position: source.position,
        videoUrl: source.videoUrl,
        videoMediaId: source.videoMediaId,
        metaTitle: source.metaTitle,
        metaDescription: source.metaDescription,
        metaKeywords: source.metaKeywords,
        canonicalUrl: null,
        ogImageMediaId: source.ogImageMediaId,
        customFields: source.customFields as Prisma.InputJsonValue,
        createdById: actor.id === "system" ? null : actor.id,
        tags: { connect: source.tags.map((tag) => ({ id: tag.id })) },
      },
      select: { id: true, slug: true, title: true },
    });

    if (source.attributeValues.length > 0) {
      await tx.productAttributeValue.createMany({
        data: source.attributeValues.map((row) => ({
          productId: created.id,
          attributeId: row.attributeId,
          valueId: row.valueId,
          valueKey: row.valueKey,
          textValue: row.textValue,
          numberValue: row.numberValue,
          boolValue: row.boolValue,
          fromVariants: row.fromVariants,
        })),
      });
    }

    const variantMap = new Map<string, string>();
    for (const variant of source.variants) {
      const copy = await tx.productVariant.create({
        data: {
          productId: created.id,
          name: variant.name,
          optionKey: variant.optionKey,
          sku: null,
          barcode: null,
          pricePaise: variant.pricePaise,
          salePricePaise: variant.salePricePaise,
          costPaise: variant.costPaise,
          weightGrams: variant.weightGrams,
          position: variant.position,
          isActive: variant.isActive,
          isDefault: variant.isDefault,
          attributeValues: { create: variant.attributeValues.map((row) => ({ attributeId: row.attributeId, valueId: row.valueId })) },
        },
        select: { id: true },
      });
      variantMap.set(variant.id, copy.id);
      await ensureInventoryItem(tx, copy.id, { actorId: actor.id === "system" ? null : actor.id, note: `Duplicated from ${source.title}` });
    }

    const imageRows: Prisma.ProductImageCreateManyInput[] = source.images.map((image) => ({
      productId: created.id,
      mediaId: image.mediaId,
      alt: image.alt,
      position: image.position,
      isPrimary: image.isPrimary,
    }));
    for (const variant of source.variants) {
      const variantId = variantMap.get(variant.id);
      if (!variantId) continue;
      for (const image of variant.images) {
        imageRows.push({ productId: created.id, variantId, mediaId: image.mediaId, alt: image.alt, position: image.position, isPrimary: false });
      }
    }
    if (imageRows.length > 0) await tx.productImage.createMany({ data: imageRows });

    if (source.customizationOptions.length > 0) {
      await tx.customizationOption.createMany({
        data: source.customizationOptions.map((option) => ({
          productId: created.id,
          type: option.type,
          label: option.label,
          helpText: option.helpText,
          placeholder: option.placeholder,
          isRequired: option.isRequired,
          minLength: option.minLength,
          maxLength: option.maxLength,
          maxFiles: option.maxFiles,
          allowedMimeTypes: option.allowedMimeTypes,
          choices: option.choices as Prisma.InputJsonValue,
          priceDeltaPaise: option.priceDeltaPaise,
          position: option.position,
          isActive: option.isActive,
        })),
      });
    }

    await ensureDefaultVariant(tx, created.id);
    await syncCustomizableFlag(tx, created.id);
    await recomputeProduct(tx, created.id);
    await writeAudit(tx, {
      actor,
      action: "product.duplicate",
      entityType: PRODUCT_ENTITY,
      entityId: created.id,
      entityLabel: created.title,
      summary: `Duplicated "${source.title}" as "${created.title}".`,
      diff: diffOf(null, { sourceId: source.id, slug: created.slug }),
      ip: meta.ip,
    });
    return { id: created.id, slug: created.slug };
  });

  await invalidatePublic(listTagsFor(PRODUCT_ENTITY));
  return result;
}

