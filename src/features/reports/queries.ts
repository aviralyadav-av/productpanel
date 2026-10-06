import "server-only";

import { can, type Actor } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { REPORT_KEYS, type ReportKey } from "@/lib/enums";
import { startOfIstDay, endOfIstDay, addDays, type DateRange } from "@/lib/dates";
import type { EntityRef } from "@/components/shared/entity-picker";

import { LAST_30_LABEL } from "./define";
import { REPORTS, summarize } from "./registry";
import type { ReportFilters, ReportHeadline, ReportSummary } from "./types";

/**
 * Read side of the reports module (Server Components and the JSON API).
 *
 * Two rules from the blueprint live here rather than in the pages:
 *
 *   D14  a report needs `reports.view` AND every code in its own `requires`,
 *        and the INDEX only lists what the actor can actually open - a card
 *        the operator cannot click is a support ticket waiting to happen.
 *   §11.28 the index headline is one aggregate per report over the last 30
 *        days; the 13 run in parallel and a single failing one degrades to a
 *        card without a number instead of failing the page.
 */

export function canOpenReport(actor: Actor, key: ReportKey): boolean {
  if (!can(actor, "reports.view")) return false;
  const requires = REPORTS[key].requires;
  return requires.every((code) => can(actor, code));
}

/** Every report this actor may open, in REPORT_KEYS order (E4's canonical order). */
export function listAllowedReports(actor: Actor): ReportSummary[] {
  return REPORT_KEYS.filter((key) => canOpenReport(actor, key)).map((key) => summarize(REPORTS[key]));
}

/** The last 30 IST days, the window every index headline is computed over. */
export function last30Days(now = new Date()): DateRange {
  return { from: startOfIstDay(addDays(now, -29)), to: endOfIstDay(now), days: 30, label: LAST_30_LABEL };
}

export type ReportCard = ReportSummary & { headline: ReportHeadline | null };

/**
 * The index: one card per allowed report with its 30-day number. Each headline
 * is a separate aggregate query, so they run together and a failure is
 * swallowed per card (the report itself will surface the error when opened).
 */
export async function reportIndexCards(actor: Actor, now = new Date()): Promise<ReportCard[]> {
  const allowed = listAllowedReports(actor);
  const range = last30Days(now);

  const headlines = await Promise.all(
    allowed.map(async (summary): Promise<ReportHeadline | null> => {
      try {
        const total = await REPORTS[summary.key].headline(range);
        return { ...total, report: summary.key };
      } catch (error) {
        console.error(`reports: headline for "${summary.key}" failed`, error);
        return null;
      }
    }),
  );

  return allowed.map((summary, index) => ({ ...summary, headline: headlines[index] }));
}

/**
 * Filter ids from the URL → display chips for the filter bar.
 *
 * EntityPicker holds an EntityRef (id + label) so it can render the current
 * selection on first paint; the URL only carries the id, so the names are
 * looked up here. An id that no longer resolves yields no chip - the filter
 * still applies, and the operator can clear it.
 */
export type ReportFilterRefs = {
  seller?: EntityRef;
  category?: EntityRef;
  product?: EntityRef;
  coupon?: EntityRef;
};

export async function resolveFilterRefs(filters: ReportFilters): Promise<ReportFilterRefs> {
  const [seller, category, product, coupon] = await Promise.all([
    filters.sellerId
      ? db.seller.findUnique({ where: { id: filters.sellerId }, select: { id: true, displayName: true, slug: true } })
      : null,
    filters.categoryId
      ? db.category.findUnique({ where: { id: filters.categoryId }, select: { id: true, name: true, path: true } })
      : null,
    filters.productId
      ? db.product.findUnique({ where: { id: filters.productId }, select: { id: true, title: true, slug: true } })
      : null,
    filters.couponId
      ? db.coupon.findUnique({ where: { id: filters.couponId }, select: { id: true, code: true, name: true } })
      : null,
  ]);

  const refs: ReportFilterRefs = {};
  if (seller) refs.seller = { id: seller.id, title: seller.displayName, subtitle: seller.slug };
  if (category) refs.category = { id: category.id, title: category.name, subtitle: category.path };
  if (product) refs.product = { id: product.id, title: product.title, subtitle: product.slug };
  if (coupon) refs.coupon = { id: coupon.id, title: coupon.code, subtitle: coupon.name };
  return refs;
}
