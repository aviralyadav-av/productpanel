import "dotenv/config";

import { db } from "@/lib/db";
import { SYSTEM_ACTOR } from "@/lib/audit";
import { parseListParams } from "@/lib/list-params";

import { exportCustomers } from "@/features/customers/export";
import { parseCustomerFilters } from "@/features/customers/filters";
import {
  getCustomerActivity,
  getCustomerAddresses,
  getCustomerDetail,
  getCustomerKpis,
  getCustomerOrders,
  getCustomerOverview,
  getCustomerPayments,
  getCustomerRefunds,
  getCustomerReturns,
  getCustomerReviews,
  getCustomerWishlist,
  getSegmentCounts,
  getTagSuggestions,
  listCustomers,
  resolveSegmentThresholds,
} from "@/features/customers/queries";

/**
 * Smoke-runs the whole read side against the REAL seeded database, because
 * every one of these functions only ever runs inside a Server Component and
 * `tsc` cannot tell whether a Prisma `select` names a column that exists.
 *
 *   node --env-file=.env --import tsx \
 *        --import ./src/features/storefront/__checks__/stub-server-only.ts \
 *        src/features/customers/__checks__/read-check.ts
 *
 * (The stub neutralises `import "server-only"`, which throws under plain Node.)
 * Read-only: nothing here writes, except the audit row the export path is
 * supposed to write, which is asserted rather than avoided.
 */

/** The seeded system user, so the export audit row satisfies AuditLog.actorId's FK. */
const ACTOR = { ...SYSTEM_ACTOR, email: "customers-read-check@local" };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

async function main(): Promise<void> {
  const thresholds = await resolveSegmentThresholds();
  console.log("thresholds:", thresholds);
  assert(thresholds.newDays > 0 && thresholds.vipMinOrders > 0, "segment thresholds resolved from settings");

  const params = parseListParams({}, { defaultSort: "createdAt", defaultOrder: "desc", pageSize: 25 });

  // --- unfiltered list + KPIs + tab counts -------------------------------------------
  const all = await listCustomers(params, parseCustomerFilters({}), thresholds);
  console.log(`list: ${all.rows.length} of ${all.total} customers, page ${all.meta.page}/${all.meta.totalPages}`);
  assert(all.total > 0, "the seeded database has customers");
  assert(all.rows.every((row) => row.deletedAt === null), "soft-deleted customers are hidden by default");

  const kpis = await getCustomerKpis(thresholds);
  console.log("kpis:", kpis);
  assert(kpis.total === all.total, "the KPI total matches the unfiltered list");
  assert(kpis.repeatRatePct >= 0 && kpis.repeatRatePct <= 100, "repeat rate is a percentage");

  const counts = await getSegmentCounts(parseCustomerFilters({}), thresholds);
  console.log("segments:", counts);
  assert(counts.all === all.total, "segment tab 'all' matches the list total");
  for (const [segment, count] of Object.entries(counts)) assert(count <= counts.all, `${segment} count never exceeds all`);

  // --- every filter dimension answers ------------------------------------------------
  const searchTerm = all.rows.find((row) => row.fullName)?.fullName?.split(" ")[0] ?? "a";
  const cases: Array<[string, Record<string, string>]> = [
    ["search by name", { q: searchTerm }],
    ["search by digits", { q: "98765" }],
    ["status", { status: "ACTIVE" }],
    ["deleted bucket", { status: "DELETED" }],
    ["marketing opt-in", { marketing: "1" }],
    ["registered window", { range: "30d" }],
    ["segment VIP", { segment: "VIP" }],
    ["segment INACTIVE", { segment: "INACTIVE" }],
  ];
  for (const [label, query] of cases) {
    const result = await listCustomers(params, parseCustomerFilters(query), thresholds);
    console.log(`filter ${label}: ${result.total}`);
  }
  for (const sort of ["name", "createdAt", "orderCount", "totalSpentPaise", "lastOrderAt"]) {
    const sorted = await listCustomers({ ...params, sort }, parseCustomerFilters({}), thresholds);
    assert(sorted.rows.length > 0, `sort by ${sort} returns rows`);
  }

  const tags = await getTagSuggestions();
  console.log(`tag suggestions: ${tags.length ? tags.slice(0, 5).join(", ") : "(none seeded)"}`);

  // --- detail + every tab on the busiest customer ------------------------------------
  const busiest = await db.customer.findFirstOrThrow({ where: { deletedAt: null }, orderBy: { orderCount: "desc" }, select: { id: true } });
  const detail = await getCustomerDetail(busiest.id);
  assert(detail, "detail loads");
  console.log(`detail ${detail.email}: segment ${detail.segment ?? "—"}, counts`, detail.counts);
  assert(detail.averageOrderValuePaise >= 0, "average order value computed");

  const overview = await getCustomerOverview(busiest.id);
  assert(overview.monthlySpend.length === 12, `the sparkline always has 12 buckets (${overview.monthlySpend.length})`);
  assert(overview.recentOrders.length <= 5, "recent orders capped at five");

  const orders = await getCustomerOrders(busiest.id, params);
  assert(orders.meta.total === detail.counts.orders, "the orders tab total matches the header count");

  const [addresses, wishlist, reviews, returns, refunds, payments, activity] = await Promise.all([
    getCustomerAddresses(busiest.id),
    getCustomerWishlist(busiest.id),
    getCustomerReviews(busiest.id),
    getCustomerReturns(busiest.id),
    getCustomerRefunds(busiest.id),
    getCustomerPayments(busiest.id),
    getCustomerActivity(busiest.id),
  ]);
  console.log(
    `tabs: ${addresses.length} addresses, ${wishlist.length} wishlist, ${reviews.length} reviews, ` +
      `${returns.length} returns, ${refunds.length} refunds, ${payments.length} payments, ` +
      `${activity.audit.length} audit / ${activity.sessions.length} sessions / ${activity.notifications.length} notifications`,
  );
  assert(addresses.length === detail.counts.addresses, "address count agrees with the header");
  assert(payments.every((row) => row.order), "every payment row carries its order for the link");

  // --- export streams the full filtered set, including an id selection ---------------
  const auditBefore = await db.auditLog.count({ where: { action: "customer.export" } });
  const csv = await exportCustomers({ format: "csv", params, filters: parseCustomerFilters({}), actor: ACTOR });
  const body = await csv.text();
  const dataLines = body.trim().split(/\r?\n/).length - 1;
  console.log(`export: ${dataLines} data rows for ${all.total} customers`);
  assert(dataLines === all.total, `the export streams every row past the first page (${dataLines} vs ${all.total})`);

  const someIds = all.rows.slice(0, 3).map((row) => row.id);
  const selected = await exportCustomers({ format: "csv", params, filters: parseCustomerFilters({}), ids: someIds, actor: ACTOR });
  const selectedLines = (await selected.text()).trim().split(/\r?\n/).length - 1;
  assert(selectedLines === someIds.length, `an id selection exports exactly those rows (${selectedLines} vs ${someIds.length})`);

  const auditAfter = await db.auditLog.count({ where: { action: "customer.export" } });
  assert(auditAfter === auditBefore + 2, `both exports were audited (${auditAfter - auditBefore})`);

  console.log("read-check: all assertions passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
