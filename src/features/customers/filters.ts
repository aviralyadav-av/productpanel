import { CUSTOMER_SEGMENTS, type CustomerSegment } from "@/lib/enums";
import { many, one, type SearchParams } from "@/lib/list-params";
import { resolveDateRangeParams } from "@/components/shared/date-range";

import { LIST_STATUS_FILTERS, type ListStatusFilter } from "./schemas";

/**
 * The customer list URL vocabulary, shared by the Server Component page, the
 * list query, the export route and the client toolbar. Client-safe.
 *
 *   ?q=&segment=&status=ACTIVE|BLOCKED|DELETED&marketing=1|0&tags=a,b
 *   &range=&from=&to=(registered)&sort=&order=&page=&pageSize=
 */

export const CUSTOMER_SORTS = ["name", "createdAt", "orderCount", "totalSpentPaise", "lastOrderAt"] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

export function resolveCustomerSort(raw: string | undefined): CustomerSort {
  return (CUSTOMER_SORTS as readonly string[]).includes(raw ?? "") ? (raw as CustomerSort) : "createdAt";
}

export function resolveSegment(raw: string | undefined): CustomerSegment | undefined {
  return (CUSTOMER_SEGMENTS as readonly string[]).includes(raw ?? "") ? (raw as CustomerSegment) : undefined;
}

export function resolveListStatus(raw: string | undefined): ListStatusFilter | undefined {
  return (LIST_STATUS_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as ListStatusFilter) : undefined;
}

export type CustomerListFilters = {
  q: string;
  segment?: CustomerSegment;
  status?: ListStatusFilter;
  acceptsMarketing?: boolean;
  tags: string[];
  /** Registered-at window. */
  from?: Date;
  to?: Date;
  /**
   * Explicit id list, used by "export selection" in the bulk bar. It narrows
   * the same `where` clause rather than filtering pages in memory: a JS filter
   * would shorten a page and make the export paginator think it had reached
   * the end.
   */
  ids?: string[];
};

function dateParam(raw: string | undefined, endOfDay: boolean): Date | undefined {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const parsed = new Date(`${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+05:30`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function parseCustomerFilters(params: SearchParams): CustomerListFilters {
  // The DateRangePicker writes ?range=<preset> (and from/to for "custom"). No
  // range params means "everyone", so the resolver only runs on a real choice.
  const range = one(params, "range");
  let from = dateParam(one(params, "from"), false);
  let to = dateParam(one(params, "to"), true);
  if (range && range !== "custom") {
    const resolved = resolveDateRangeParams(params, "30d");
    from = resolved.from;
    to = resolved.to;
  }

  const marketing = one(params, "marketing");
  const tags = [
    ...new Set(
      many(params, "tags")
        .flatMap((value) => value.split(","))
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];

  return {
    q: (one(params, "q") ?? "").trim(),
    segment: resolveSegment(one(params, "segment")),
    status: resolveListStatus(one(params, "status")),
    acceptsMarketing: marketing === "1" ? true : marketing === "0" ? false : undefined,
    tags,
    from,
    to,
  };
}

export function hasActiveFilters(filters: CustomerListFilters): boolean {
  return Boolean(
    filters.q || filters.segment || filters.status || filters.acceptsMarketing !== undefined || filters.tags.length > 0 || filters.from || filters.to,
  );
}

/** Column definitions for ColumnVisibilityMenu (tableKey "customers"), brief section 7. */
export const CUSTOMER_COLUMNS = [
  { key: "name", label: "Customer", locked: true },
  { key: "phone", label: "Phone" },
  { key: "createdAt", label: "Registered" },
  { key: "orderCount", label: "Orders" },
  { key: "totalSpentPaise", label: "Total spent" },
  { key: "lastOrderAt", label: "Last order" },
  { key: "status", label: "Status" },
  { key: "segment", label: "Segment" },
  { key: "tags", label: "Tags", defaultHidden: true },
  { key: "marketing", label: "Marketing", defaultHidden: true },
] as const;

/** Detail page tabs (`?tab=`). */
export const CUSTOMER_TABS = [
  "overview",
  "profile",
  "addresses",
  "orders",
  "wishlist",
  "reviews",
  "returns",
  "refunds",
  "payments",
  "activity",
  "danger",
] as const;
export type CustomerTab = (typeof CUSTOMER_TABS)[number];

export const CUSTOMER_TAB_LABELS: Record<CustomerTab, string> = {
  overview: "Overview",
  profile: "Profile",
  addresses: "Addresses",
  orders: "Orders",
  wishlist: "Wishlist",
  reviews: "Reviews",
  returns: "Returns",
  refunds: "Refunds",
  payments: "Payments",
  activity: "Activity",
  danger: "Danger zone",
};

export function resolveTab(raw: string | undefined): CustomerTab {
  return (CUSTOMER_TABS as readonly string[]).includes(raw ?? "") ? (raw as CustomerTab) : "overview";
}
