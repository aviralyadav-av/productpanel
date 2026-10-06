import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type { ProductStatus, StockState } from "@/lib/enums";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";
import { getSettingBoolean, getSettingNumber, getSettingString } from "@/lib/settings";
import {
  resolveCategoryAttributes,
  resolveForProduct,
  type EffectiveAttribute,
} from "@/features/catalog/attribute-resolution";
import { buildAttrWhere, parseAttrFilters } from "@/features/catalog/facets";
import { validateProductForPublish, type PublishProblem } from "@/features/catalog/publish-validation";
import { getStockSummaryForProduct, type ProductStockSummary } from "@/features/inventory/service";

import { CUSTOMIZATION_OPTION_SELECT, type CustomizationOptionRecord } from "./customization-service";
import { PRODUCT_FLAG_COLUMNS, resolveProductSort, type ProductListFilters, type ProductSort } from "./filters";
import { PRODUCT_CORE_SELECT, type ProductCore } from "./internal";
import { getCategoryOptions, type CategoryOption } from "./reference-queries";

export { getAttributeCatalog, getCategoryOptions, getSellerRef, type AttributeCatalogEntry, type CategoryOption } from "./reference-queries";

/**
 * Read side of the products module, for Server Components and the REST GETs.
 * Nothing here invents a number: stock comes from InventoryItem rows the
 * ledger maintains, prices from the service-maintained effective columns.
 */

const LIVE: Prisma.ProductWhereInput = { deletedAt: null };

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export type ProductRow = {
  id: string;
  slug: string;
  title: string;
  baseSku: string | null;
  status: string;
  thumbnailUrl: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryPath: string | null;
  sellerId: string | null;
  sellerName: string | null;
  pricePaise: number;
  salePricePaise: number | null;
  effectivePricePaise: number;
  minVariantPricePaise: number;
  maxVariantPricePaise: number;
  promotionPricePaise: number | null;
  onHand: number;
  available: number;
  stockState: StockState;
  variantCount: number;
  isFeatured: boolean;
  isNewArrival: boolean;
  isBestseller: boolean;
  isTrending: boolean;
  isCustomizable: boolean;
  updatedAt: Date;
  createdAt: Date;
};

export type ProductListResult = { rows: ProductRow[]; total: number; meta: PageMeta };

const STOCK_WHERE: Record<NonNullable<ProductListFilters["stock"]>, Prisma.ProductWhereInput> = {
  in: { variants: { some: { isActive: true, deletedAt: null, inventory: { available: { gt: 0 } } } } },
  low: { variants: { some: { isActive: true, deletedAt: null, inventory: { stockState: "LOW_STOCK" } } } },
  out: {
    variants: { none: { isActive: true, deletedAt: null, inventory: { OR: [{ available: { gt: 0 } }, { allowBackorder: true }] } } },
  },
};

/** Every filter except `status`, so the status tabs can count against the rest. */
async function buildWhere(filters: ProductListFilters, options: { withStatus: boolean }): Promise<Prisma.ProductWhereInput> {
  const clauses: Prisma.ProductWhereInput[] = [LIVE];

  if (filters.q) {
    clauses.push({
      OR: [
        { title: { contains: filters.q, mode: "insensitive" } },
        { slug: { contains: filters.q, mode: "insensitive" } },
        { baseSku: { contains: filters.q, mode: "insensitive" } },
        { variants: { some: { sku: { contains: filters.q, mode: "insensitive" }, deletedAt: null } } },
      ],
    });
  }
  if (options.withStatus && filters.status) clauses.push({ status: filters.status });

  if (filters.categoryId === "none") {
    clauses.push({ categoryId: null });
  } else if (filters.categoryId) {
    if (filters.includeDescendants) {
      const category = await db.category.findUnique({ where: { id: filters.categoryId }, select: { path: true } });
      clauses.push(
        category
          ? { OR: [{ categoryId: filters.categoryId }, { categoryPath: category.path }, { categoryPath: { startsWith: `${category.path}/` } }] }
          : { categoryId: filters.categoryId },
      );
    } else {
      clauses.push({ categoryId: filters.categoryId });
    }
  }

  if (filters.platformOnly) clauses.push({ sellerId: null });
  else if (filters.sellerId) clauses.push({ sellerId: filters.sellerId });

  if (filters.stock) clauses.push(STOCK_WHERE[filters.stock]);

  if (filters.minPricePaise !== undefined || filters.maxPricePaise !== undefined) {
    clauses.push({ effectivePricePaise: { gte: filters.minPricePaise, lte: filters.maxPricePaise } });
  }
  if (filters.from || filters.to) clauses.push({ createdAt: { gte: filters.from, lte: filters.to } });

  for (const flag of filters.flags) clauses.push({ [PRODUCT_FLAG_COLUMNS[flag]]: true });

  if (Object.keys(filters.attr).length > 0) {
    // attr[<code>] filters resolve against the selected category's effective
    // set (or the global set when none is selected), same as the storefront.
    const effective = await resolveCategoryAttributes(filters.categoryId && filters.categoryId !== "none" ? filters.categoryId : null);
    const params: Record<string, string> = {};
    for (const [code, value] of Object.entries(filters.attr)) params[`attr[${code}]`] = value;
    clauses.push(...buildAttrWhere(parseAttrFilters(params), effective));
  }

  return { AND: clauses };
}

const LIST_SELECT = {
  id: true,
  slug: true,
  title: true,
  baseSku: true,
  status: true,
  categoryId: true,
  sellerId: true,
  pricePaise: true,
  salePricePaise: true,
  effectivePricePaise: true,
  minVariantPricePaise: true,
  maxVariantPricePaise: true,
  promotionPricePaise: true,
  isFeatured: true,
  isNewArrival: true,
  isBestseller: true,
  isTrending: true,
  isCustomizable: true,
  updatedAt: true,
  createdAt: true,
  category: { select: { name: true } },
  seller: { select: { displayName: true } },
  images: { where: { variantId: null }, orderBy: [{ isPrimary: "desc" }, { position: "asc" }], take: 1, select: { media: { select: { thumbnailUrl: true, url: true } } } },
  _count: { select: { variants: { where: { deletedAt: null } } } },
} satisfies Prisma.ProductSelect;

type ListRecord = Prisma.ProductGetPayload<{ select: typeof LIST_SELECT }>;

type StockTotals = { onHand: number; available: number; stockState: StockState };

const STATE_RANK: Record<StockState, number> = { IN_STOCK: 0, LOW_STOCK: 1, BACKORDER: 2, OUT_OF_STOCK: 3 };

/** Stock for a set of products: active, live variants only; best state wins (same rule as the inventory summary). */
async function stockFor(productIds: readonly string[]): Promise<Map<string, StockTotals>> {
  if (productIds.length === 0) return new Map();
  const items = await db.inventoryItem.findMany({
    where: { variant: { productId: { in: [...productIds] }, isActive: true, deletedAt: null } },
    select: { onHand: true, available: true, stockState: true, variant: { select: { productId: true } } },
  });
  const totals = new Map<string, StockTotals>();
  for (const item of items) {
    const key = item.variant.productId;
    const current = totals.get(key) ?? { onHand: 0, available: 0, stockState: "OUT_OF_STOCK" as StockState };
    current.onHand += item.onHand;
    current.available += item.available;
    const state = item.stockState as StockState;
    if (STATE_RANK[state] < STATE_RANK[current.stockState]) current.stockState = state;
    totals.set(key, current);
  }
  return totals;
}

function toRow(record: ListRecord, stock: Map<string, StockTotals>, namePaths: Map<string, string>): ProductRow {
  const totals = stock.get(record.id) ?? { onHand: 0, available: 0, stockState: "OUT_OF_STOCK" as StockState };
  const image = record.images[0]?.media;
  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    baseSku: record.baseSku,
    status: record.status,
    thumbnailUrl: image?.thumbnailUrl ?? image?.url ?? null,
    categoryId: record.categoryId,
    categoryName: record.category?.name ?? null,
    categoryPath: record.categoryId ? (namePaths.get(record.categoryId) ?? record.category?.name ?? null) : null,
    sellerId: record.sellerId,
    sellerName: record.seller?.displayName ?? null,
    pricePaise: record.pricePaise,
    salePricePaise: record.salePricePaise,
    effectivePricePaise: record.effectivePricePaise,
    minVariantPricePaise: record.minVariantPricePaise,
    maxVariantPricePaise: record.maxVariantPricePaise,
    promotionPricePaise: record.promotionPricePaise,
    onHand: totals.onHand,
    available: totals.available,
    stockState: totals.stockState,
    variantCount: record._count.variants,
    isFeatured: record.isFeatured,
    isNewArrival: record.isNewArrival,
    isBestseller: record.isBestseller,
    isTrending: record.isTrending,
    isCustomizable: record.isCustomizable,
    updatedAt: record.updatedAt,
    createdAt: record.createdAt,
  };
}

function orderBy(sort: ProductSort, order: "asc" | "desc"): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case "title":
      return [{ title: order }, { id: "asc" }];
    case "category":
      return [{ category: { path: order } }, { title: "asc" }];
    case "seller":
      return [{ seller: { displayName: order } }, { title: "asc" }];
    case "price":
      return [{ effectivePricePaise: order }, { id: "asc" }];
    case "status":
      return [{ status: order }, { updatedAt: "desc" }];
    case "createdAt":
      return [{ createdAt: order }, { id: "asc" }];
    default:
      return [{ updatedAt: order }, { id: "asc" }];
  }
}

export async function listProducts(params: ListParams, filters: ProductListFilters): Promise<ProductListResult> {
  const where = await buildWhere(filters, { withStatus: true });
  const sort = resolveProductSort(params.sort);
  const categories = await getCategoryOptions();
  const namePaths = new Map(categories.map((category) => [category.id, category.namePath]));

  const total = await db.product.count({ where });

  let records: ListRecord[];
  if (sort === "stock") {
    // Stock is a SUM over a relation, which Prisma cannot ORDER BY. The id list
    // for one filter is bounded (a few thousand at most) so sorting it in
    // memory and fetching the page is the honest option; a denormalised stock
    // column would be the next step if the catalogue grows past that.
    const ids = (await db.product.findMany({ where, select: { id: true }, take: 10_000 })).map((row) => row.id);
    const stock = await stockFor(ids);
    const ordered = ids
      .sort((a, b) => {
        const diff = (stock.get(a)?.available ?? 0) - (stock.get(b)?.available ?? 0);
        return (params.order === "asc" ? diff : -diff) || a.localeCompare(b);
      })
      .slice(params.skip, params.skip + params.pageSize);
    const page = await db.product.findMany({ where: { id: { in: ordered } }, select: LIST_SELECT });
    const byId = new Map(page.map((row) => [row.id, row]));
    records = ordered.map((id) => byId.get(id)).filter((row): row is ListRecord => Boolean(row));
  } else {
    records = await db.product.findMany({ where, orderBy: orderBy(sort, params.order), skip: params.skip, take: params.pageSize, select: LIST_SELECT });
  }

  const stock = await stockFor(records.map((row) => row.id));
  return {
    rows: records.map((record) => toRow(record, stock, namePaths)),
    total,
    meta: buildPageMeta(total, params),
  };
}

export type StatusCounts = Record<"all" | ProductStatus, number>;

export async function getStatusCounts(filters: ProductListFilters): Promise<StatusCounts> {
  const where = await buildWhere(filters, { withStatus: false });
  const groups = await db.product.groupBy({ by: ["status"], where, _count: { _all: true } });
  const counts: StatusCounts = { all: 0, DRAFT: 0, PUBLISHED: 0, ARCHIVED: 0 };
  for (const group of groups) {
    counts.all += group._count._all;
    if (group.status in counts) counts[group.status as ProductStatus] = group._count._all;
  }
  return counts;
}

export type ProductKpis = {
  total: number;
  published: number;
  draft: number;
  archived: number;
  outOfStock: number;
  lowStock: number;
  customizable: number;
};

/** Whole-catalogue tiles; independent of the list filters so they read as "the store", not "this page". */
export async function getProductKpis(): Promise<ProductKpis> {
  const [total, published, draft, archived, customizable, outOfStock, lowStock] = await Promise.all([
    db.product.count({ where: LIVE }),
    db.product.count({ where: { ...LIVE, status: "PUBLISHED" } }),
    db.product.count({ where: { ...LIVE, status: "DRAFT" } }),
    db.product.count({ where: { ...LIVE, status: "ARCHIVED" } }),
    db.product.count({ where: { ...LIVE, isCustomizable: true } }),
    db.product.count({ where: { ...LIVE, status: { not: "ARCHIVED" }, ...STOCK_WHERE.out } }),
    db.product.count({ where: { ...LIVE, status: { not: "ARCHIVED" }, ...STOCK_WHERE.low } }),
  ]);
  return { total, published, draft, archived, outOfStock, lowStock, customizable };
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export type EditorImage = {
  id: string;
  mediaId: string;
  url: string;
  thumbnailUrl: string | null;
  filename: string;
  alt: string | null;
  position: number;
  isPrimary: boolean;
};

export type EditorVariant = {
  id: string;
  name: string;
  optionKey: string | null;
  sku: string | null;
  barcode: string | null;
  pricePaise: number | null;
  salePricePaise: number | null;
  costPaise: number | null;
  weightGrams: number | null;
  position: number;
  isActive: boolean;
  isDefault: boolean;
  attributeValues: Array<{ attributeId: string; valueId: string }>;
  inventory: { onHand: number; reserved: number; available: number; stockState: StockState; lowStockThreshold: number } | null;
  images: Array<{ id: string; mediaId: string; url: string; thumbnailUrl: string | null }>;
};

export type EditorAttributeValue = {
  attributeId: string;
  valueId: string | null;
  textValue: string | null;
  numberValue: number | null;
  boolValue: boolean | null;
  fromVariants: boolean;
};

export type OrphanAttribute = {
  attributeId: string;
  code: string;
  name: string;
  inputType: string;
  labels: string[];
  fromVariants: boolean;
};

export type ActivityEntry = { id: string; action: string; summary: string; actorEmail: string; createdAt: Date };

export type MediaRef = { id: string; url: string; thumbnailUrl: string | null; filename: string };

export type EditorProduct = ProductCore & {
  tags: string[];
  metaKeywordList: string[];
  category: { id: string; name: string; path: string; namePath: string } | null;
  seller: { id: string; displayName: string; status: string } | null;
  video: MediaRef | null;
  ogImage: MediaRef | null;
  images: EditorImage[];
  variants: EditorVariant[];
  customizationOptions: CustomizationOptionRecord[];
  attributeValues: EditorAttributeValue[];
  effectiveAttributes: EffectiveAttribute[];
  orphanAttributes: OrphanAttribute[];
  publish: { ok: boolean; problems: PublishProblem[] };
  stock: ProductStockSummary;
  performance: { orderCount: number; viewCount: number; ratingAvg: number; reviewCount: number; orderItemCount: number };
  activity: ActivityEntry[];
};

const mediaRef = (media: { id: string; url: string; thumbnailUrl: string | null; filename: string } | null): MediaRef | null =>
  media ? { id: media.id, url: media.url, thumbnailUrl: media.thumbnailUrl, filename: media.filename } : null;

export async function getProductForEditor(id: string): Promise<EditorProduct | null> {
  const product = await db.product.findUnique({
    where: { id },
    select: {
      ...PRODUCT_CORE_SELECT,
      orderCount: true,
      viewCount: true,
      ratingAvg: true,
      reviewCount: true,
      tags: { select: { name: true }, orderBy: { name: "asc" } },
      category: { select: { id: true, name: true, path: true } },
      seller: { select: { id: true, displayName: true, status: true } },
      video: { select: { id: true, url: true, thumbnailUrl: true, filename: true } },
      ogImage: { select: { id: true, url: true, thumbnailUrl: true, filename: true } },
      images: {
        where: { variantId: null },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { id: true, mediaId: true, alt: true, position: true, isPrimary: true, media: { select: { url: true, thumbnailUrl: true, filename: true } } },
      },
      variants: {
        where: { deletedAt: null },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          optionKey: true,
          sku: true,
          barcode: true,
          pricePaise: true,
          salePricePaise: true,
          costPaise: true,
          weightGrams: true,
          position: true,
          isActive: true,
          isDefault: true,
          attributeValues: { select: { attributeId: true, valueId: true } },
          inventory: { select: { onHand: true, reserved: true, available: true, stockState: true, lowStockThreshold: true } },
          images: { orderBy: { position: "asc" }, select: { id: true, mediaId: true, media: { select: { url: true, thumbnailUrl: true } } } },
        },
      },
      customizationOptions: { orderBy: [{ position: "asc" }, { id: "asc" }], select: CUSTOMIZATION_OPTION_SELECT },
      attributeValues: {
        select: {
          attributeId: true,
          valueId: true,
          textValue: true,
          numberValue: true,
          boolValue: true,
          fromVariants: true,
          attribute: { select: { code: true, name: true, inputType: true } },
          value: { select: { value: true, label: true } },
        },
      },
      _count: { select: { orderItems: true } },
    },
  });
  if (!product || product.deletedAt) return null;

  const [effectiveAttributes, publish, stock, activity, categories] = await Promise.all([
    resolveForProduct(id),
    validateProductForPublish(undefined, id),
    getStockSummaryForProduct(id),
    db.auditLog.findMany({
      where: { entityType: "product", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { id: true, action: true, summary: true, actorEmail: true, createdAt: true },
    }),
    getCategoryOptions(),
  ]);

  const effectiveIds = new Set(effectiveAttributes.map((entry) => entry.attribute.id));
  const orphans = new Map<string, OrphanAttribute>();
  for (const row of product.attributeValues) {
    if (effectiveIds.has(row.attributeId)) continue;
    const current = orphans.get(row.attributeId) ?? {
      attributeId: row.attributeId,
      code: row.attribute.code,
      name: row.attribute.name,
      inputType: row.attribute.inputType,
      labels: [],
      fromVariants: false,
    };
    const label =
      row.value?.label ?? row.value?.value ?? row.textValue ?? (row.numberValue !== null ? String(row.numberValue) : row.boolValue === null ? null : row.boolValue ? "Yes" : "No");
    if (label) current.labels.push(label);
    current.fromVariants = current.fromVariants || row.fromVariants;
    orphans.set(row.attributeId, current);
  }

  const { tags, orderCount, viewCount, ratingAvg, reviewCount, _count, category, seller, video, ogImage, images, variants, customizationOptions, attributeValues, ...core } = product;

  return {
    ...core,
    tags: tags.map((tag) => tag.name),
    metaKeywordList: (core.metaKeywords ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    category: category
      ? { ...category, namePath: categories.find((option) => option.id === category.id)?.namePath ?? category.name }
      : null,
    seller,
    video: mediaRef(video),
    ogImage: mediaRef(ogImage),
    images: images.map((image) => ({
      id: image.id,
      mediaId: image.mediaId,
      url: image.media.url,
      thumbnailUrl: image.media.thumbnailUrl,
      filename: image.media.filename,
      alt: image.alt,
      position: image.position,
      isPrimary: image.isPrimary,
    })),
    variants: variants.map((variant) => ({
      ...variant,
      inventory: variant.inventory ? { ...variant.inventory, stockState: variant.inventory.stockState as StockState } : null,
      images: variant.images.map((image) => ({ id: image.id, mediaId: image.mediaId, url: image.media.url, thumbnailUrl: image.media.thumbnailUrl })),
    })),
    customizationOptions,
    attributeValues: attributeValues.map(({ attribute, value, ...row }) => {
      void attribute;
      void value;
      return row;
    }),
    effectiveAttributes,
    orphanAttributes: [...orphans.values()],
    publish,
    stock,
    performance: { orderCount, viewCount, ratingAvg, reviewCount, orderItemCount: _count.orderItems },
    activity,
  };
}

export type EditorBootstrap = {
  categories: CategoryOption[];
  tagSuggestions: string[];
  defaultTaxBps: number;
  storefrontBaseUrl: string;
  previewEnabled: boolean;
};

/** Reference data both editor pages need; cheap enough to load on every render. */
export async function getEditorBootstrap(): Promise<EditorBootstrap> {
  const [categories, tags, defaultTaxBps, storefrontBaseUrl, previewEnabled] = await Promise.all([
    getCategoryOptions(),
    db.tag.findMany({ orderBy: { name: "asc" }, take: 300, select: { name: true } }),
    getSettingNumber("tax.default_bps"),
    getSettingString("storefront.base_url"),
    getSettingBoolean("storefront.preview_enabled"),
  ]);
  return { categories, tagSuggestions: tags.map((tag) => tag.name), defaultTaxBps, storefrontBaseUrl, previewEnabled };
}

/** Effective attribute set for the category the operator just picked (before saving). */
export async function getEffectiveAttributes(categoryId: string | null): Promise<EffectiveAttribute[]> {
  return resolveCategoryAttributes(categoryId);
}

/** REST detail: the editor payload minus the derived helpers other clients recompute themselves. */
export async function getProductDetail(id: string) {
  return getProductForEditor(id);
}
