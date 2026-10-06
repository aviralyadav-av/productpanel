import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { Plus } from "lucide-react";

import { can, requirePermission } from "@/lib/auth/guards";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { formatNumber, formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { PaginationBar } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";

import { CouponsTable } from "@/features/coupons/components/coupons-table";
import { CouponsToolbar } from "@/features/coupons/components/coupons-toolbar";
import { couponKpis, listCoupons } from "@/features/coupons/queries";
import { parseCouponListFilters, resolveCouponSort } from "@/features/coupons/schemas";

export const metadata: Metadata = { title: "Coupons" };

/**
 * /admin/coupons (blueprint §1 Coupons, §4.7, F8).
 *
 * URL state: q, status (derived), type, fundedBy, sort, order, page. The KPI
 * strip and the list run in parallel; both derive status with the same
 * function the checkout rule engine uses.
 */
export default async function CouponsPage({ searchParams }: PageProps<"/admin/coupons">) {
  const actor = await requirePermission("coupons.view");

  const params = (await searchParams) as SearchParams;
  const listParams = parseListParams(params, { defaultSort: "updatedAt", defaultOrder: "desc" });
  const filters = parseCouponListFilters(params);
  const sort = resolveCouponSort(listParams.sort);
  const canManage = can(actor, "coupons.manage");

  const [list, kpis] = await Promise.all([listCoupons({ ...listParams, sort }, filters), couponKpis()]);
  const hasFilters = Boolean(listParams.q || filters.status || filters.type || filters.fundedBy || filters.appliesTo);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Coupons"
        description="Discount codes customers enter at checkout. Status is derived from the schedule, the switch and the usage limit; the same rules validate the code at checkout."
        actions={
          canManage ? (
            <Button asChild size="sm">
              <Link href={"/admin/coupons/new" as Route}>
                <Plus /> New coupon
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Active" value={formatNumber(kpis.active)} href={"/admin/coupons?status=ACTIVE" as Route} hint="Redeemable right now" />
        <StatCard label="Scheduled" value={formatNumber(kpis.scheduled)} href={"/admin/coupons?status=SCHEDULED" as Route} hint="Start date in the future" />
        <StatCard label="Expired" value={formatNumber(kpis.expired)} href={"/admin/coupons?status=EXPIRED" as Route} hint={`${kpis.exhausted} exhausted, ${kpis.disabled} disabled`} />
        <StatCard label="Redemptions" value={formatNumber(kpis.redemptions)} hint="All time, every coupon" />
        <StatCard label="Discount given" value={formatPaise(kpis.discountGivenPaise)} hint="Sum of coupon discounts on orders" />
      </div>

      <CouponsToolbar statusCounts={list.statusCounts} />

      <CouponsTable rows={list.rows} meta={list.meta} sort={sort} order={listParams.order} canManage={canManage} hasFilters={hasFilters} />

      {list.meta.totalPages > 1 ? <PaginationBar meta={list.meta} itemLabel="coupons" /> : null}
    </div>
  );
}
