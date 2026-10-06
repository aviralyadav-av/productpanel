import type { Prisma, PrismaClient } from "@prisma/client";

import { resolveCategoryAttributes, effectiveByCode, isSelectType, type EffectiveAttribute } from "@/features/catalog/attribute-resolution";
import { recomputeProductFacets } from "@/features/catalog/facets";
import { recomputeProductPricing } from "@/features/catalog/pricing";
import { generateVariants } from "@/features/catalog/variants";
import { applyStockMovement, ensureInventoryItem } from "@/features/inventory/service";
import { sanitizeHtml } from "@/lib/sanitize/html";
import { slugify, type SeedContext } from "./context";
import { hueForCategoryPath } from "./demo-media";
import { PRODUCTS, type ProductSpec } from "../lib/catalog";
import { rupees } from "../lib/money";
import { productImageSvg, putDemoSvg } from "../lib/placeholders";
import { addDays, createRng, daysAgo, type Rng } from "../lib/rng";
import {
  categoryBySlug,
  demoId,
  mediaId,
  registerMedia,
  state,
  transaction,
  type DemoProduct,
  type Tx,
} from "../lib/state";

/**
 * Demo products (blueprint §12, §14.A). Each product is created in ONE
 * transaction through the real catalogue services: attribute values are
 * validated against the category's effective set (A1), variants come from
 * `generateVariants` (A5), stock enters through `ensureInventoryItem` /
 * `applyStockMovement` as SEED movements (C3, F7), and facets + pricing are
 * recomputed at the end (A3, A4) exactly as the admin product editor would.
 *
 * Idempotent: a product whose id already exists is skipped wholesale - the
 * transaction either committed everything or nothing.
 */

type AttributeIndex = Map<
  string,
  { id: string; name: string; inputType: string; values: Map<string, { id: string; label: string; colorHex: string | null }> }
>;

async function loadAttributeIndex(db: PrismaClient): Promise<AttributeIndex> {
  const rows = await db.attribute.findMany({
    select: { id: true, code: true, name: true, inputType: true, values: { select: { id: true, value: true, label: true, colorHex: true } } },
  });
  return new Map(
    rows.map((row) => [
      row.code,
      {
        id: row.id,
        name: row.name,
        inputType: row.inputType,
        values: new Map(row.values.map((value) => [value.value, { id: value.id, label: value.label ?? value.value, colorHex: value.colorHex }])),
      },
    ]),
  );
}

function valueIdFor(index: AttributeIndex, code: string, slug: string, productTitle: string): string {
  const attribute = index.get(code);
  const value = attribute?.values.get(slug);
  if (!value) throw new Error(`Product "${productTitle}": attribute "${code}" has no value "${slug}"`);
  return value.id;
}

function openingStock(spec: ProductSpec, index: number, rng: Rng): number {
  if (spec.stock === "out") return 0;
  if (spec.stock === "low") return rng.chance(0.2) ? 0 : rng.int(1, 3);
  if (Array.isArray(spec.stock)) return spec.stock[Math.min(index, spec.stock.length - 1)] ?? 0;
  if (spec.stock >= 5) return rng.int(Math.round(spec.stock * 0.7), Math.round(spec.stock * 1.3));
  return spec.stock;
}

function saleWindow(spec: ProductSpec, now: Date): { saleStartsAt: Date | null; saleEndsAt: Date | null } {
  if (!spec.sale) return { saleStartsAt: null, saleEndsAt: null };
  switch (spec.saleWindow ?? "active") {
    case "future":
      return { saleStartsAt: addDays(now, 10), saleEndsAt: addDays(now, 40) };
    case "past":
      return { saleStartsAt: daysAgo(now, 60), saleEndsAt: daysAgo(now, 30) };
    default:
      return { saleStartsAt: daysAgo(now, 5), saleEndsAt: addDays(now, 25) };
  }
}

/**
 * Product-level attribute rows for every effective attribute that is not a
 * variant axis: the spec's value when given, a deterministic pick when the
 * attribute is required, nothing otherwise. Global `handmade` is always true.
 */
function attributeRows(
  spec: ProductSpec,
  productId: string,
  effective: EffectiveAttribute[],
  axes: Set<string>,
  index: AttributeIndex,
  rng: Rng,
  warn: (message: string) => void,
): Prisma.ProductAttributeValueCreateManyInput[] {
  const rows: Prisma.ProductAttributeValueCreateManyInput[] = [];
  const byCode = effectiveByCode(effective);
  for (const code of Object.keys(spec.attrs ?? {})) {
    if (!byCode.has(code)) warn(`"${spec.title}": attribute "${code}" is not in the effective set of ${spec.category}; skipped`);
  }
  for (const entry of effective) {
    const code = entry.attribute.code;
    if (axes.has(code)) continue;
    const given = spec.attrs?.[code];
    const attributeId = entry.attribute.id;

    if (isSelectType(entry.attribute.inputType)) {
      let slugs = given === undefined ? [] : Array.isArray(given) ? given : [String(given)];
      if (slugs.length === 0 && entry.isRequired && entry.values.length > 0) slugs = [rng.pick(entry.values).value];
      for (const slug of slugs) {
        const valueId = valueIdFor(index, code, slug, spec.title);
        rows.push({ productId, attributeId, valueId, valueKey: valueId });
      }
      continue;
    }
    if (entry.attribute.inputType === "NUMBER") {
      let value: number | null = typeof given === "number" ? given : null;
      if (value === null && code === "weight") value = spec.weight;
      if (value === null && entry.isRequired) value = rng.int(50, 900);
      if (value !== null) rows.push({ productId, attributeId, valueKey: "_", numberValue: value });
      continue;
    }
    if (entry.attribute.inputType === "BOOLEAN") {
      rows.push({ productId, attributeId, valueKey: "_", boolValue: typeof given === "boolean" ? given : true });
      continue;
    }
    // TEXT
    let text: string | null = typeof given === "string" ? given : null;
    if (text === null && code === "dimensions" && spec.dims) text = `${spec.dims[0]} × ${spec.dims[1]} × ${spec.dims[2]} cm`;
    if (text === null && entry.isRequired) text = "See description";
    if (text !== null) rows.push({ productId, attributeId, valueKey: "_", textValue: text });
  }
  return rows;
}

async function createProduct(
  db: PrismaClient,
  ctx: SeedContext,
  spec: ProductSpec,
  index: AttributeIndex,
  rng: Rng,
  warn: (message: string) => void,
): Promise<void> {
  const now = state.now;
  const id = demoId("prod", spec.n);
  const category = categoryBySlug(spec.category);
  if (!category.isLeaf) throw new Error(`Product "${spec.title}" targets non-leaf category ${spec.category}`);
  const sellerId = spec.seller ? demoId("seller", spec.seller) : null;
  const hue = hueForCategoryPath(category.path);
  const status = spec.status ?? "PUBLISHED";
  const createdAt = daysAgo(now, spec.ageDays);
  const effective = await resolveCategoryAttributes(category.id, db);
  const byCode = effectiveByCode(effective);

  // ---- axes -----------------------------------------------------------------------
  const axes = Object.entries(spec.axes ?? {}).map(([code, slugs]) => {
    const entry = byCode.get(code);
    if (!entry) throw new Error(`Product "${spec.title}": axis "${code}" is not in the effective set of ${spec.category}`);
    if (!entry.isVariant) throw new Error(`Product "${spec.title}": axis "${code}" is not variant-defining for ${spec.category}`);
    return { code, attributeId: entry.attribute.id, valueIds: slugs.map((slug) => valueIdFor(index, code, slug, spec.title)) };
  });
  const colourAxis = spec.axes?.colour ?? [];
  const colorHexes = colourAxis
    .map((slug) => index.get("colour")?.values.get(slug)?.colorHex ?? null)
    .filter((hex): hex is string => Boolean(hex));

  // ---- images (outside the tx: storage writes are not transactional anyway) --------
  const images: Array<{ mediaId: string; url: string; alt: string }> = [];
  let videoMediaId: string | null = null;
  if (typeof spec.images === "object") {
    const photos = state.legacyPhotos.get(spec.images.legacy) ?? [];
    for (const photo of photos.filter((item) => item.kind === "image").slice(0, spec.images.count ?? 3)) {
      images.push({ mediaId: photo.id, url: photo.url, alt: spec.title });
    }
    const video = (state.legacyPhotos.get("bags") ?? []).find((item) => item.kind === "video");
    if (video && spec.images.legacy === "handbags") videoMediaId = video.id;
  }
  if (images.length === 0) {
    const count = typeof spec.images === "number" ? spec.images : 2;
    for (let i = 1; i <= count; i += 1) {
      const asset = await putDemoSvg(db, {
        id: demoId("media_prod", spec.n, i),
        key: `demo/products/demo_prod_${String(spec.n).padStart(3, "0")}-${i}.svg`,
        svg: productImageSvg({ title: spec.title, subtitle: category.name, hue, colorHexes, variant: i - 1 }),
        folderId: mediaId("folder:demo/products"),
        alt: `${spec.title} - ${i === 1 ? "front" : i === 2 ? "detail" : "in use"}`,
        width: 1000,
        height: 1000,
        uploadedById: ctx.adminUserId,
      });
      images.push({ mediaId: asset.id, url: asset.url, alt: `${spec.title} - ${i === 1 ? "front" : i === 2 ? "detail" : "in use"}` });
    }
  }
  for (const [i, image] of images.entries()) registerMedia(`product:${spec.n}:${i + 1}`, image.mediaId, image.url);

  const baseSku = `DB-${String(spec.n).padStart(3, "0")}`;
  const { saleStartsAt, saleEndsAt } = saleWindow(spec, now);

  await transaction(db, async (tx: Tx) => {
    await tx.product.create({
      data: {
        id,
        slug: slugify(spec.title),
        baseSku,
        title: spec.title,
        shortDescription: spec.short,
        description: sanitizeHtml(spec.desc, "rich"),
        categoryId: category.id,
        sellerId,
        brand: spec.brand ?? null,
        status,
        publishedAt: status === "PUBLISHED" ? addDays(createdAt, 1) : null,
        pricePaise: rupees(spec.price),
        salePricePaise: spec.sale ? rupees(spec.sale) : null,
        saleStartsAt,
        saleEndsAt,
        costPaise: rupees(spec.cost),
        taxRateBps: spec.tax,
        hsnCode: spec.hsn,
        weightGrams: spec.weight,
        lengthMm: spec.dims ? spec.dims[0] * 10 : null,
        widthMm: spec.dims ? spec.dims[1] * 10 : null,
        heightMm: spec.dims ? spec.dims[2] * 10 : null,
        shippingNote: spec.shippingNote ?? null,
        isFeatured: spec.flags?.featured ?? false,
        isNewArrival: spec.flags?.newArrival ?? false,
        isBestseller: spec.flags?.bestseller ?? false,
        isTrending: spec.flags?.trending ?? false,
        isCustomizable: Boolean(spec.customization?.length),
        minOrderQty: spec.minOrderQty ?? 1,
        maxOrderQty: spec.maxOrderQty ?? null,
        position: spec.n,
        videoMediaId,
        metaTitle: `${spec.title} | Handmade on DIY Baazar`,
        metaDescription: spec.short,
        metaKeywords: [...spec.tags, category.name.toLowerCase(), "handmade"].join(", "),
        customFields: {},
        createdById: ctx.adminUserId,
        createdAt,
        tags: { connect: spec.tags.map((tag) => ({ slug: slugify(tag) })) },
      },
    });

    // ---- product-level attribute values (A8) ---------------------------------------
    const rows = attributeRows(spec, id, effective, new Set(axes.map((axis) => axis.code)), index, rng, warn);
    if (rows.length > 0) await tx.productAttributeValue.createMany({ data: rows, skipDuplicates: true });

    // ---- images -------------------------------------------------------------------
    await tx.productImage.createMany({
      data: images.map((image, i) => ({
        id: demoId("pimg", spec.n, i + 1),
        productId: id,
        mediaId: image.mediaId,
        alt: image.alt,
        position: i,
        isPrimary: i === 0,
      })),
    });

    // ---- variants + opening stock (A5, C3) -------------------------------------------
    let variantIds: string[];
    if (axes.length > 0) {
      const result = await generateVariants(tx, {
        productId: id,
        axes: axes.map((axis) => ({ attributeId: axis.attributeId, valueIds: axis.valueIds })),
        actorId: ctx.adminUserId,
      });
      variantIds = result.variantIds;
      const variants = await tx.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: { id: true, position: true, attributeValues: { select: { value: { select: { value: true } } } } },
        orderBy: { position: "asc" },
      });
      for (const [i, variant] of variants.entries()) {
        const delta = variant.attributeValues.reduce((sum, row) => sum + (spec.variantPrices?.[row.value.value] ?? 0), 0);
        await tx.productVariant.update({
          where: { id: variant.id },
          data: {
            sku: `${baseSku}-${String(i + 1).padStart(2, "0")}`,
            pricePaise: delta > 0 ? rupees(spec.price + delta) : null,
            salePricePaise: delta > 0 && spec.sale ? rupees(spec.sale + delta) : null,
          },
        });
        const quantity = openingStock(spec, i, rng);
        if (quantity > 0) {
          await applyStockMovement(tx, {
            variantId: variant.id,
            delta: quantity,
            type: "SEED",
            reason: "Opening balance",
            note: "Demo seed opening stock",
            actorId: ctx.adminUserId,
          });
        }
      }
    } else {
      const variantId = demoId("var", spec.n, 1);
      await tx.productVariant.create({
        data: { id: variantId, productId: id, name: "Default", sku: `${baseSku}-01`, position: 0, isActive: true, isDefault: true },
      });
      await ensureInventoryItem(tx, variantId, {
        onHand: openingStock(spec, 0, rng),
        actorId: ctx.adminUserId,
        note: "Demo seed opening stock",
      });
      variantIds = [variantId];
    }
    // The ledger should read as if stock was booked when the listing went live.
    await tx.stockMovement.updateMany({ where: { variantId: { in: variantIds }, type: "SEED" }, data: { createdAt } });
    await tx.inventoryItem.updateMany({ where: { variantId: { in: variantIds } }, data: { updatedAt: createdAt } });

    // ---- customisation options (§4.2) --------------------------------------------------
    if (spec.customization?.length) {
      await tx.customizationOption.createMany({
        data: spec.customization.map((option, i) => ({
          id: demoId("copt", spec.n, i + 1),
          productId: id,
          type: option.type,
          label: option.label,
          helpText: option.helpText ?? null,
          placeholder: option.placeholder ?? null,
          isRequired: option.isRequired ?? false,
          minLength: option.minLength ?? null,
          maxLength: option.maxLength ?? null,
          maxFiles: option.maxFiles ?? null,
          allowedMimeTypes: option.allowedMimeTypes ?? [],
          choices: (option.choices ?? []).map((choice) => ({ value: choice.value, label: choice.label, priceDeltaPaise: choice.priceDeltaPaise ?? 0, imageUrl: null })),
          priceDeltaPaise: option.priceDeltaPaise ?? 0,
          position: i,
          isActive: true,
        })),
      });
    }

    await recomputeProductFacets(tx, id);
    await recomputeProductPricing(tx, { productIds: [id], now });
  });
}

async function loadProducts(db: PrismaClient): Promise<DemoProduct[]> {
  const rows = await db.product.findMany({
    where: { id: { startsWith: "demo_prod_" }, deletedAt: null },
    orderBy: { position: "asc" },
    select: {
      id: true,
      slug: true,
      title: true,
      brand: true,
      status: true,
      categoryId: true,
      categoryPath: true,
      sellerId: true,
      pricePaise: true,
      salePricePaise: true,
      saleStartsAt: true,
      saleEndsAt: true,
      taxRateBps: true,
      hsnCode: true,
      costPaise: true,
      isCustomizable: true,
      isBestseller: true,
      createdAt: true,
      images: { where: { isPrimary: true }, select: { media: { select: { url: true } } }, take: 1 },
      variants: {
        where: { deletedAt: null },
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          sku: true,
          optionKey: true,
          pricePaise: true,
          salePricePaise: true,
          isDefault: true,
          isActive: true,
          attributeValues: { select: { attribute: { select: { name: true } }, value: { select: { label: true, value: true } } } },
          inventory: { select: { available: true, allowBackorder: true } },
        },
      },
      customizationOptions: {
        where: { isActive: true },
        orderBy: { position: "asc" },
        select: { id: true, type: true, label: true, isRequired: true, priceDeltaPaise: true, maxFiles: true, choices: true },
      },
    },
  });
  return rows.map((row) => ({
    ...row,
    imageUrl: row.images[0]?.media.url ?? null,
    variants: row.variants.map((variant) => ({
      id: variant.id,
      productId: row.id,
      name: variant.name,
      sku: variant.sku,
      optionKey: variant.optionKey,
      pricePaise: variant.pricePaise,
      salePricePaise: variant.salePricePaise,
      isDefault: variant.isDefault,
      isActive: variant.isActive,
      attributes: Object.fromEntries(variant.attributeValues.map((item) => [item.attribute.name, item.value.label ?? item.value.value])),
      available: variant.inventory?.available ?? 0,
      allowBackorder: variant.inventory?.allowBackorder ?? false,
    })),
    options: row.customizationOptions.map((option) => ({
      id: option.id,
      type: option.type,
      label: option.label,
      isRequired: option.isRequired,
      priceDeltaPaise: option.priceDeltaPaise,
      maxFiles: option.maxFiles,
      choices: Array.isArray(option.choices)
        ? (option.choices as Array<{ value: string; label: string; priceDeltaPaise?: number }>).map((choice) => ({
            value: choice.value,
            label: choice.label,
            priceDeltaPaise: choice.priceDeltaPaise ?? 0,
          }))
        : [],
    })),
  }));
}

export async function seedDemoProducts(db: PrismaClient, ctx: SeedContext): Promise<void> {
  const rng = createRng("products");
  const index = await loadAttributeIndex(db);
  const warnings = new Set<string>();
  const warn = (message: string) => warnings.add(message);

  // ---- tags -----------------------------------------------------------------------
  const tagSlugs = new Set(PRODUCTS.flatMap((spec) => spec.tags.map(slugify)));
  for (const slug of tagSlugs) {
    const name = slug.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
    await db.tag.upsert({ where: { slug }, update: {}, create: { id: demoId("tag", slug), slug, name } });
  }

  // ---- products -------------------------------------------------------------------
  let created = 0;
  let skipped = 0;
  for (const spec of PRODUCTS) {
    const exists = await db.product.findUnique({ where: { id: demoId("prod", spec.n) }, select: { id: true } });
    if (exists) {
      skipped += 1;
      continue;
    }
    await createProduct(db, ctx, spec, index, rng, warn);
    created += 1;
  }
  for (const message of warnings) ctx.log(`warning: ${message}`);

  // ---- seller counters (C7) ---------------------------------------------------------
  for (const seller of state.sellers) {
    const [productCount, publishedProductCount] = await Promise.all([
      db.product.count({ where: { sellerId: seller.id, deletedAt: null } }),
      db.product.count({ where: { sellerId: seller.id, deletedAt: null, status: "PUBLISHED" } }),
    ]);
    await db.seller.update({ where: { id: seller.id }, data: { productCount, publishedProductCount } });
  }

  state.products = await loadProducts(db);
  const variants = state.products.reduce((sum, product) => sum + product.variants.length, 0);
  const options = state.products.reduce((sum, product) => sum + product.options.length, 0);
  ctx.log(`products: ${state.products.length} (created ${created}, existing ${skipped}), variants ${variants}, customisation options ${options}, tags ${tagSlugs.size}`);
}
