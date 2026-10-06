import { z } from "zod";

/**
 * Search vocabulary shared by the server (service.ts) and the browser (⌘K
 * menu, EntityPicker). Kept free of Prisma so a client component can import
 * it without dragging the database driver into the bundle.
 */

export const SEARCH_SCOPES = [
  "product",
  "order",
  "customer",
  "seller",
  "category",
  "coupon",
  "page",
  "blog",
] as const;

export type SearchScope = (typeof SEARCH_SCOPES)[number];
export const searchScopeSchema = z.enum(SEARCH_SCOPES);

/** The permission that unlocks each scope (blueprint §14.D14). */
export const SEARCH_SCOPE_PERMISSIONS: Record<SearchScope, string> = {
  product: "products.view",
  order: "orders.view",
  customer: "customers.view",
  seller: "sellers.view",
  category: "categories.view",
  coupon: "coupons.view",
  page: "pages.view",
  blog: "blog.view",
};

export const SEARCH_SCOPE_LABELS: Record<SearchScope, { singular: string; plural: string }> = {
  product: { singular: "Product", plural: "Products" },
  order: { singular: "Order", plural: "Orders" },
  customer: { singular: "Customer", plural: "Customers" },
  seller: { singular: "Seller", plural: "Sellers" },
  category: { singular: "Category", plural: "Categories" },
  coupon: { singular: "Coupon", plural: "Coupons" },
  page: { singular: "Page", plural: "Pages" },
  blog: { singular: "Blog post", plural: "Blog posts" },
};

/**
 * One hit. This is the wire contract with `EntityPicker`
 * (src/components/shared/entity-picker.tsx): { scope, id, title, subtitle?,
 * imageUrl?, href } inside `{ data: { results } }`.
 */
export type SearchHit = {
  scope: SearchScope;
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string | null;
  href: string;
};

export type SearchResult = { results: SearchHit[] };

export const SEARCH_MIN_QUERY = 1;
export const SEARCH_MAX_QUERY = 100;
export const SEARCH_DEFAULT_LIMIT = 8;
export const SEARCH_MAX_LIMIT = 50;

export const searchInputSchema = z.object({
  q: z.string().trim().min(SEARCH_MIN_QUERY).max(SEARCH_MAX_QUERY),
  scopes: z.array(searchScopeSchema).min(1).optional(),
  limit: z.coerce.number().int().min(1).max(SEARCH_MAX_LIMIT).default(SEARCH_DEFAULT_LIMIT),
});

export type SearchInput = z.input<typeof searchInputSchema>;

/** Parse "product,order" from a query string into scopes (unknown ones dropped). */
export function parseScopesParam(raw: string | null | undefined): SearchScope[] | undefined {
  if (!raw) return undefined;
  const scopes = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is SearchScope => (SEARCH_SCOPES as readonly string[]).includes(part));
  return scopes.length > 0 ? scopes : undefined;
}

/** Group hits by scope, preserving SEARCH_SCOPES order, for the results page. */
export function groupHits(hits: readonly SearchHit[]): { scope: SearchScope; hits: SearchHit[] }[] {
  return SEARCH_SCOPES.map((scope) => ({
    scope,
    hits: hits.filter((hit) => hit.scope === scope),
  })).filter((group) => group.hits.length > 0);
}
