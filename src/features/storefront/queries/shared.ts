import type { Prisma } from "@prisma/client";

/**
 * Rules every public catalogue read shares (blueprint §5.3, §11.31, D11).
 *
 * "Eligible product" has ONE definition so a product that is hidden from the
 * listing can never surface through a homepage strip, a related-products rail
 * or the sitemap: PUBLISHED, not soft-deleted, sold by the platform itself or
 * by an ACTIVE seller, and (when categorised) in an active category. The
 * link-availability check in ../links.ts applies the same rule to rows that
 * are loaded as link targets.
 *
 * These are plain data - no `server-only`, no `next/*` - so the denylist check
 * script and future tests can import them under plain tsx.
 */

export const ELIGIBLE_PRODUCT_WHERE: Prisma.ProductWhereInput = {
  status: "PUBLISHED",
  deletedAt: null,
  AND: [
    { OR: [{ sellerId: null }, { seller: { status: "ACTIVE", deletedAt: null } }] },
    { OR: [{ categoryId: null }, { category: { isActive: true } }] },
  ],
};

/** Eligible AND every extra clause; `AND` so callers' own `OR`s never collide with ours. */
export function eligibleProductWhere(extra: ReadonlyArray<Prisma.ProductWhereInput> = []): Prisma.ProductWhereInput {
  return extra.length === 0 ? ELIGIBLE_PRODUCT_WHERE : { AND: [ELIGIBLE_PRODUCT_WHERE, ...extra] };
}

/** Products in a category or anywhere below it, via the denormalised path (A3). */
export function categorySubtreeWhere(path: string): Prisma.ProductWhereInput {
  return { OR: [{ categoryPath: path }, { categoryPath: { startsWith: `${path}/` } }] };
}

export const ACTIVE_SELLER_WHERE: Prisma.SellerWhereInput = { status: "ACTIVE", deletedAt: null };

export const APPROVED_REVIEW_WHERE: Prisma.ReviewWhereInput = { status: "APPROVED" };

/**
 * Posts the storefront may show right now.
 *
 * SCHEDULED means "PUBLISHED from `publishedAt` onwards" (the contract stated
 * in src/features/blog/schemas.ts) and there is no `blog.publish_scheduled`
 * job type in JOB_TYPES, so nothing ever rewrites the row - the read side is
 * what makes a scheduled post go live. A SCHEDULED row therefore needs a
 * publishedAt that has passed; only a PUBLISHED row may have none at all.
 */
export function publishedBlogWhere(now: Date): Prisma.BlogPostWhereInput {
  return {
    OR: [
      { status: "PUBLISHED", OR: [{ publishedAt: null }, { publishedAt: { lte: now } }] },
      { status: "SCHEDULED", publishedAt: { lte: now } },
    ],
  };
}

// ---------------------------------------------------------------------------
// Pagination (§5.1 meta shape)
// ---------------------------------------------------------------------------

export type PageInput = { page: number; pageSize: number };

export type PageMeta = { page: number; pageSize: number; total: number; totalPages: number };

export function parsePageInput(
  searchParams: URLSearchParams,
  { defaultSize, maxSize }: { defaultSize: number; maxSize: number },
): PageInput {
  const page = Math.max(1, Math.floor(Number(searchParams.get("page") ?? 1) || 1));
  const rawSize = Math.floor(Number(searchParams.get("pageSize") ?? defaultSize) || defaultSize);
  const pageSize = Math.min(maxSize, Math.max(1, rawSize));
  return { page, pageSize };
}

export function pageMeta(total: number, input: PageInput): PageMeta {
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  return { page: Math.min(input.page, totalPages), pageSize: input.pageSize, total, totalPages };
}

export function skipFor(input: PageInput): number {
  return (input.page - 1) * input.pageSize;
}

/** Flag query params: `featured=true`, `featured=1`, or the bare key. */
export function flagParam(searchParams: URLSearchParams, key: string): boolean {
  if (!searchParams.has(key)) return false;
  const value = (searchParams.get(key) ?? "").trim().toLowerCase();
  return value === "" || value === "1" || value === "true" || value === "yes";
}

/** Trimmed, length-capped string param or null. */
export function textParam(searchParams: URLSearchParams, key: string, max = 120): string | null {
  const value = (searchParams.get(key) ?? "").trim();
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

/** Keep referenced ids in the order the operator listed them. */
export function orderByIds<T extends { id: string }>(rows: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const out: T[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row) out.push(row);
  }
  return out;
}
