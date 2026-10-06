import { PRODUCT_STATUSES, type ProductStatus } from "@/lib/enums";
import { many, one, type SearchParams } from "@/lib/list-params";
import { resolveDateRangeParams } from "@/components/shared/date-range";

/**
 * The product list's URL vocabulary (blueprint §14.A7), shared by the Server
 * Component page, the list query and the Client Component toolbar. Nothing
 * here touches the database, so client bundles can import it freely.
 *
 *   ?q=&status=&category=&includeDescendants=1&seller=&stock=in|low|out
 *   &minPrice=&maxPrice=(rupees)&from=&to=&range=&flags=featured,new,...
 *   &attr[<code>]=v1,v2&sort=&order=&page=&pageSize=
 */

export const PRODUCT_SORTS = [
  "title",
  "category",
  "seller",
  "price",
  "stock",
  "status",
  "updatedAt",
  "createdAt",
] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export function resolveProductSort(raw: string | undefined): ProductSort {
  return (PRODUCT_SORTS as readonly string[]).includes(raw ?? "") ? (raw as ProductSort) : "updatedAt";
}

export const STOCK_FILTERS = ["in", "low", "out"] as const;
export type StockFilter = (typeof STOCK_FILTERS)[number];

export const STOCK_FILTER_LABELS: Record<StockFilter, string> = {
  in: "In stock",
  low: "Low stock",
  out: "Out of stock",
};

export function resolveStockFilter(raw: string | undefined): StockFilter | undefined {
  return (STOCK_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as StockFilter) : undefined;
}

export const PRODUCT_FLAGS = ["featured", "newArrival", "bestseller", "trending", "customizable"] as const;
export type ProductFlag = (typeof PRODUCT_FLAGS)[number];

export const PRODUCT_FLAG_LABELS: Record<ProductFlag, string> = {
  featured: "Featured",
  newArrival: "New arrival",
  bestseller: "Bestseller",
  trending: "Trending",
  customizable: "Customisable",
};

export const PRODUCT_FLAG_COLUMNS: Record<ProductFlag, "isFeatured" | "isNewArrival" | "isBestseller" | "isTrending" | "isCustomizable"> = {
  featured: "isFeatured",
  newArrival: "isNewArrival",
  bestseller: "isBestseller",
  trending: "isTrending",
  customizable: "isCustomizable",
};

export function resolveStatus(raw: string | undefined): ProductStatus | undefined {
  return (PRODUCT_STATUSES as readonly string[]).includes(raw ?? "") ? (raw as ProductStatus) : undefined;
}

export type ProductListFilters = {
  q: string;
  status?: ProductStatus;
  categoryId?: string;
  includeDescendants: boolean;
  sellerId?: string;
  /** "platform" = products with no seller. */
  platformOnly: boolean;
  stock?: StockFilter;
  minPricePaise?: number;
  maxPricePaise?: number;
  from?: Date;
  to?: Date;
  flags: ProductFlag[];
  /** attr[<code>]=v1,v2 or attr[<code>]=min..max, raw. */
  attr: Record<string, string>;
};

function rupeesParam(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : undefined;
}

function dateParam(raw: string | undefined, endOfDay: boolean): Date | undefined {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const parsed = new Date(`${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+05:30`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

const ATTR_KEY = /^attr\[([A-Za-z0-9_-]+)\]$/;

export function parseProductFilters(params: SearchParams): ProductListFilters {
  const truthy = (value: string | undefined) => value === "1" || value === "true";
  const flagsRaw = [...many(params, "flags").flatMap((value) => value.split(",")), ...many(params, "flag")];
  const flags = PRODUCT_FLAGS.filter((flag) => flagsRaw.includes(flag));
  // Legacy/A7 aliases: ?featured=1 etc.
  for (const flag of PRODUCT_FLAGS) {
    if (truthy(one(params, flag)) && !flags.includes(flag)) flags.push(flag);
  }

  const attr: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const match = ATTR_KEY.exec(key);
    if (!match || value === undefined) continue;
    const first = Array.isArray(value) ? value[0] : value;
    if (first && first.trim()) attr[match[1]] = first.trim();
  }

  const seller = one(params, "seller");

  // The DateRangePicker writes ?range=<preset> (and from/to for "custom"). A
  // list with no range params must show everything, so the resolver only runs
  // when the operator actually chose something.
  const range = one(params, "range");
  let from = dateParam(one(params, "from"), false);
  let to = dateParam(one(params, "to"), true);
  if (range && range !== "custom") {
    const resolved = resolveDateRangeParams(params, "30d");
    from = resolved.from;
    to = resolved.to;
  }

  return {
    q: (one(params, "q") ?? "").trim(),
    status: resolveStatus(one(params, "status")),
    categoryId: one(params, "category"),
    includeDescendants: one(params, "includeDescendants") !== "0",
    sellerId: seller && seller !== "platform" ? seller : undefined,
    platformOnly: seller === "platform",
    stock: resolveStockFilter(one(params, "stock")),
    minPricePaise: rupeesParam(one(params, "minPrice")),
    maxPricePaise: rupeesParam(one(params, "maxPrice")),
    from,
    to,
    flags,
    attr,
  };
}

/** True when anything beyond the default view is applied (for the empty state copy). */
export function hasActiveFilters(filters: ProductListFilters): boolean {
  return Boolean(
    filters.q ||
      filters.status ||
      filters.categoryId ||
      filters.sellerId ||
      filters.platformOnly ||
      filters.stock ||
      filters.minPricePaise !== undefined ||
      filters.maxPricePaise !== undefined ||
      filters.from ||
      filters.to ||
      filters.flags.length > 0 ||
      Object.keys(filters.attr).length > 0,
  );
}

/** Column definitions for ColumnVisibilityMenu (tableKey "products"). */
export const PRODUCT_COLUMNS = [
  { key: "title", label: "Product", locked: true },
  { key: "category", label: "Category" },
  { key: "seller", label: "Seller" },
  { key: "price", label: "Price" },
  { key: "stock", label: "Stock" },
  { key: "status", label: "Status" },
  { key: "flags", label: "Flags" },
  { key: "updatedAt", label: "Updated" },
  { key: "createdAt", label: "Created", defaultHidden: true },
] as const;
