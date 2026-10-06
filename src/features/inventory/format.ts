import { formatIstDate } from "@/lib/dates";
import { mergeQuery } from "@/lib/list-params";

/**
 * Small presentation helpers shared by the inventory components. Client-safe:
 * no database, no `server-only`.
 */

export const INVENTORY_PATH = "/admin/inventory";

/** `/admin/inventory?...` from a set of query changes applied to nothing. */
export function inventoryHref(query: Record<string, string | number | null | undefined>): string {
  return `${INVENTORY_PATH}${mergeQuery("", query)}`;
}

export function productHref(productId: string): string {
  return `/admin/products/${productId}`;
}

export function orderHref(orderId: string): string {
  return `/admin/orders/${orderId}`;
}

export function variantLabel(productTitle: string, variantName: string): string {
  return variantName && variantName !== "Default" ? `${productTitle} · ${variantName}` : productTitle;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "just now", "12m ago", "3h ago", "6d ago", then the IST date. Coarse on
 * purpose: the exact timestamp is one hover (title attribute) away.
 */
export function relativeTime(date: Date, now: Date = new Date()): string {
  const elapsed = now.getTime() - date.getTime();
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 30 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;
  return formatIstDate(date);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
