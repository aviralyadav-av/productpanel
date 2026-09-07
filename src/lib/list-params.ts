/**
 * List state lives in the URL, never in React state.
 *
 * That single decision removes most client state from list screens: the page
 * stays a Server Component that reads searchParams, the browser back button
 * works, and any view an operator is looking at can be pasted to someone else.
 */

export type SearchParams = Record<string, string | string[] | undefined>;

export type ListParams = {
  page: number;
  pageSize: number;
  q: string;
  sort: string;
  order: "asc" | "desc";
  skip: number;
};

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export function one(
  params: SearchParams,
  key: string,
): string | undefined {
  const value = params[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.length > 0 ? first : undefined;
}

export function many(params: SearchParams, key: string): string[] {
  const value = params[key];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

export function parseListParams(
  params: SearchParams,
  options: { defaultSort?: string; defaultOrder?: "asc" | "desc"; pageSize?: number } = {},
): ListParams {
  const page = Math.max(1, Number(one(params, "page") ?? 1) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(5, Number(one(params, "pageSize") ?? options.pageSize ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE),
  );
  const order = one(params, "order") === "asc" ? "asc" : options.defaultOrder ?? "desc";

  return {
    page,
    pageSize,
    q: (one(params, "q") ?? "").trim(),
    sort: one(params, "sort") ?? options.defaultSort ?? "createdAt",
    order,
    skip: (page - 1) * pageSize,
  };
}

/**
 * Offset pagination, not keyset.
 *
 * Keyset is the right answer for feeds with millions of rows and no page
 * numbers. This store has 39 products and a few hundred orders, and an
 * operator genuinely wants "page 3 of 7" and the ability to jump. Offset is
 * correct here and revisitable if the order table ever passes ~100k rows.
 */
export function buildPageMeta(total: number, params: ListParams) {
  const totalPages = Math.max(1, Math.ceil(total / params.pageSize));
  return {
    page: Math.min(params.page, totalPages),
    pageSize: params.pageSize,
    total,
    totalPages,
    from: total === 0 ? 0 : params.skip + 1,
    to: Math.min(params.skip + params.pageSize, total),
  };
}

export type PageMeta = ReturnType<typeof buildPageMeta>;

/** Merge changes into the current query string, dropping empties. */
export function mergeQuery(
  current: URLSearchParams | string,
  changes: Record<string, string | number | null | undefined>,
): string {
  const params = new URLSearchParams(
    typeof current === "string" ? current : current.toString(),
  );

  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value === "") {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
  }

  // Any change to a filter invalidates the current page number.
  if (!("page" in changes)) params.delete("page");

  const query = params.toString();
  return query ? `?${query}` : "";
}
