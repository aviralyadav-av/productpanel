/**
 * Client-safe vocabulary for /admin/audit-log (blueprint §1 Audit log, §14.D13).
 *
 * The log is append-only and deliberately unopinionated about what a module
 * writes into it, so this file holds only what the SCREEN needs: how the URL
 * describes a filter, and how to turn an `entityType` into a link to the thing
 * that changed.
 */
import { z } from "zod";

import { one, type SearchParams } from "@/lib/list-params";
import { startOfIstDay, endOfIstDay } from "@/lib/dates";
import {
  DATE_RANGE_PRESETS,
  resolvePreset,
  type DateRangePreset,
} from "@/components/shared/date-range";

export const AUDIT_SORTS = ["createdAt", "action", "actor", "entityType"] as const;
export type AuditSort = (typeof AUDIT_SORTS)[number];

export function resolveAuditSort(raw: string | undefined): AuditSort {
  return (AUDIT_SORTS as readonly string[]).includes(raw ?? "")
    ? (raw as AuditSort)
    : "createdAt";
}

export type AuditFilters = {
  q: string;
  actorId: string | undefined;
  entityType: string | undefined;
  /** Matches `action` by prefix, e.g. "order" selects order.* */
  actionPrefix: string | undefined;
  from: Date | undefined;
  to: Date | undefined;
};

/** `YYYY-MM-DD` is an IST day, inclusive at both ends (§11.27). */
export function parseIstDayParam(value: string | undefined, end: boolean): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return end ? endOfIstDay(parsed) : startOfIstDay(parsed);
}

/**
 * The window the screen opens on. The DateRangePicker always renders SOME
 * preset as its label, so the query has to honour the same default or the
 * control would claim a window the list is not applying.
 */
export const DEFAULT_AUDIT_RANGE = "30d" as const;

/**
 * The DateRangePicker writes either `?range=<preset>` or `?from=&to=`; both
 * shapes are read here so the page, the REST list and the export can never
 * disagree about which rows are in scope.
 */
export function parseAuditFilters(params: SearchParams): AuditFilters {
  const preset = one(params, "range");
  const explicitFrom = parseIstDayParam(one(params, "from"), false);
  const explicitTo = parseIstDayParam(one(params, "to"), true);

  const resolved =
    preset && preset !== "custom" && isDateRangePreset(preset)
      ? resolvePreset(preset)
      : !explicitFrom && !explicitTo
        ? resolvePreset(DEFAULT_AUDIT_RANGE)
        : null;

  return {
    q: (one(params, "q") ?? "").trim(),
    actorId: one(params, "actor"),
    entityType: one(params, "entity"),
    actionPrefix: one(params, "action"),
    from: resolved?.from ?? explicitFrom,
    to: resolved?.to ?? explicitTo,
  };
}

function isDateRangePreset(value: string): value is Exclude<DateRangePreset, "custom"> {
  return (DATE_RANGE_PRESETS as readonly string[]).includes(value) && value !== "custom";
}

/**
 * True when the operator narrowed anything themselves. The default 30-day
 * window does not count: an empty list inside it is "nothing happened
 * recently", not "your filters are too tight".
 */
export function hasAuditFilters(filters: AuditFilters): boolean {
  return Boolean(filters.q || filters.actorId || filters.entityType || filters.actionPrefix);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type AuditRow = {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorEmail: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  summary: string;
  ip: string | null;
  userAgent: string | null;
  diff: unknown;
};

export type AuditFacets = {
  actors: Array<{ id: string; label: string; count: number }>;
  entityTypes: Array<{ value: string; count: number }>;
  actionPrefixes: Array<{ value: string; count: number }>;
};

// ---------------------------------------------------------------------------
// Deep links
// ---------------------------------------------------------------------------

/**
 * Where an audited entity lives in the admin. Only entity types with a real
 * detail route are listed - a missing entry renders as plain text rather than
 * a link that 404s.
 */
const ENTITY_ROUTES: Record<string, (id: string) => string> = {
  Product: (id) => `/admin/products/${id}`,
  ProductVariant: (id) => `/admin/products/${id}`,
  Order: (id) => `/admin/orders/${id}`,
  Customer: (id) => `/admin/customers/${id}`,
  Seller: (id) => `/admin/sellers/${id}`,
  Category: (id) => `/admin/categories/${id}`,
  Coupon: (id) => `/admin/coupons/${id}`,
  Promotion: (id) => `/admin/promotions/${id}`,
  Banner: (id) => `/admin/banners/${id}`,
  CmsPage: (id) => `/admin/pages/${id}`,
  BlogPost: (id) => `/admin/blog/${id}`,
  User: (id) => `/admin/users/${id}`,
  Role: (id) => `/admin/roles/${id}`,
  ReturnRequest: (id) => `/admin/returns/${id}`,
  Refund: (id) => `/admin/refunds/${id}`,
  SellerPayout: (id) => `/admin/payouts/${id}`,
  Review: (id) => `/admin/reviews?review=${id}`,
  ContactInquiry: (id) => `/admin/inquiries/${id}`,
};

export function entityHref(entityType: string, entityId: string | null): string | null {
  if (!entityId) return null;
  const build = ENTITY_ROUTES[entityType];
  return build ? build(entityId) : null;
}

/** "order.status_change" -> "Status change"; the prefix is shown separately. */
export function actionLabel(action: string): string {
  const [, ...rest] = action.split(".");
  const tail = rest.join(".") || action;
  const words = tail.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function actionPrefixOf(action: string): string {
  return action.split(".")[0] ?? action;
}

/** Human label for a module prefix, e.g. "blog_category" -> "Blog category". */
export function prefixLabel(prefix: string): string {
  const words = prefix.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------------------------------------------------------------------------
// Diff rendering
// ---------------------------------------------------------------------------

export type DiffField = { field: string; from: unknown; to: unknown };

/**
 * Audit diffs come in two shapes: `{ field: { from, to } }` from `diffOf` on
 * an update, and a plain object snapshot on a create or delete. Both are
 * flattened to before/after rows here so the dialog has one renderer.
 */
export function diffFields(diff: unknown): DiffField[] {
  if (!diff || typeof diff !== "object" || Array.isArray(diff)) return [];

  return Object.entries(diff as Record<string, unknown>).map(([field, value]) => {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      ("from" in value || "to" in value)
    ) {
      const pair = value as { from?: unknown; to?: unknown };
      return { field, from: pair.from ?? null, to: pair.to ?? null };
    }
    // A snapshot (create/delete): there is only one side, and which side it is
    // depends on the action, so both are shown and the dialog labels it.
    return { field, from: undefined, to: value };
  });
}

export function isRedacted(value: unknown): boolean {
  return value === "[redacted]";
}

/** Render any diff value as a short readable string. */
export function formatDiffValue(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") return value === "" ? '""' : value;
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const auditIdSchema = z.string().min(1).max(64);
