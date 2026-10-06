import { Suspense } from "react";
import type { Metadata } from "next";
import type { Route } from "next";

import { can, requirePermission } from "@/lib/auth/guards";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { canOpenReport } from "@/features/reports/queries";
import { resolveDashboardRange } from "@/features/dashboard/data";
import { hasDemoData } from "@/features/dashboard/queries";
import { DashboardToolbar } from "@/features/dashboard/components/dashboard-toolbar";
import { DemoDataBanner } from "@/features/dashboard/components/demo-banner";
import {
  ChartSkeleton,
  KpiSkeleton,
  ListSkeleton,
} from "@/features/dashboard/components/safe-panel";
import {
  ActivityListPanel,
  AlertsListPanel,
  CategorySalesPanel,
  CustomerGrowthPanel,
  KpiSection,
  OrdersChartPanel,
  PaymentSplitPanel,
  RecentCustomersListPanel,
  RecentOrdersListPanel,
  RecentReviewsListPanel,
  RecentSellersListPanel,
  RevenueChartPanel,
  SellerGrowthPanel,
  TopProductsListPanel,
  TopSellersListPanel,
  UnitsChartPanel,
} from "@/features/dashboard/components/panels";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * /admin/dashboard — the business-intelligence home (blueprint §1, §2, E4).
 *
 * Three rules shape this file:
 *
 *  1. It computes nothing. Every metric comes from
 *     `@/features/reports/metrics` through `features/dashboard/data.ts`, so a
 *     figure here and the same figure on its report cannot drift (E4). The
 *     only reads this module owns are the "recent N" strips and the alert
 *     list, which no report answers.
 *  2. Every widget is bound to its module's permission and omitted
 *     server-side when the actor lacks it (D14). `dashboard.view` opens the
 *     page; it does not, on its own, show a single number.
 *  3. Every panel is its own Suspense island with its own error boundary
 *     (SafePanel), so one slow or broken aggregate cannot blank the other
 *     fourteen.
 */
export default async function DashboardPage({
  searchParams,
}: PageProps<"/admin/dashboard">) {
  const actor = await requirePermission("dashboard.view");
  const params = await searchParams;
  const range = resolveDashboardRange(params);

  const see = (permission: string) => can(actor, permission);
  const seeOrders = see("orders.view");
  const isDemo = await hasDemoData();

  // "View report" only appears when the actor can actually open that report:
  // reports.view plus the report's own `requires` (D14, reports registry).
  const reportHrefFor = (key: Parameters<typeof canOpenReport>[1]): Route | undefined =>
    canOpenReport(actor, key) ? (`/admin/reports/${key}` as Route) : undefined;

  const firstName = actor.name?.split(" ")[0] ?? "there";

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Good to see you, ${firstName}`}
        description={`${range.label} · every figure is computed from live order, catalogue and inventory rows, in IST business days.`}
        actions={<DashboardToolbar query={range.query} />}
      />

      {isDemo ? <DemoDataBanner /> : null}

      <Suspense fallback={<KpiSkeleton />}>
        <KpiSection range={range} allowed={see} />
      </Suspense>

      {/* Revenue + what needs attention ------------------------------------ */}
      <div className="grid gap-3 xl:grid-cols-3">
        {seeOrders ? (
          <Panel
            title="Revenue"
            description={`Revenue, net sales and refunds per ${range.bucket}`}
            className="xl:col-span-2"
            bodyClassName="p-0"
            viewAllHref={reportHrefFor("revenue")}
            viewAllLabel="View report"
          >
            <Suspense fallback={<ChartSkeleton height={230} />}>
              <RevenueChartPanel range={range} />
            </Suspense>
          </Panel>
        ) : null}

        <Panel
          title="Needs attention"
          description="Computed live from stock, approvals, payments and the job queue"
          bodyClassName="p-0"
        >
          <Suspense fallback={<ListSkeleton rows={5} />}>
            <AlertsListPanel allowed={see} />
          </Suspense>
        </Panel>
      </div>

      {/* Order pipeline + payment mix -------------------------------------- */}
      {seeOrders ? (
        <div className="grid gap-3 xl:grid-cols-3">
          <Panel
            title="Orders by status"
            description="The pipeline over time, folded into five states"
            className="xl:col-span-2"
            bodyClassName="p-0"
            viewAllHref={reportHrefFor("orders")}
            viewAllLabel="View report"
          >
            <Suspense fallback={<ChartSkeleton height={230} />}>
              <OrdersChartPanel range={range} />
            </Suspense>
          </Panel>

          <Panel
            title="Payment methods"
            description="Revenue split by how the order was paid"
            bodyClassName="p-0"
            viewAllHref={reportHrefFor("revenue")}
            viewAllLabel="View report"
          >
            <Suspense fallback={<ChartSkeleton height={200} />}>
              <PaymentSplitPanel range={range} />
            </Suspense>
          </Panel>
        </div>
      ) : null}

      {/* Growth + units ----------------------------------------------------- */}
      <div className="grid gap-3 xl:grid-cols-3">
        {see("customers.view") ? (
          <Panel
            title="Customer growth"
            description="New sign-ups per bucket, with the running total"
            bodyClassName="p-0"
            viewAllHref={reportHrefFor("customers")}
            viewAllLabel="View report"
          >
            <Suspense fallback={<ChartSkeleton height={200} />}>
              <CustomerGrowthPanel range={range} />
            </Suspense>
          </Panel>
        ) : null}

        {see("sellers.view") ? (
          <Panel
            title="Seller growth"
            description="Registrations and approvals per bucket"
            bodyClassName="p-0"
            viewAllHref={reportHrefFor("sellers")}
            viewAllLabel="View report"
          >
            <Suspense fallback={<ChartSkeleton height={200} />}>
              <SellerGrowthPanel range={range} />
            </Suspense>
          </Panel>
        ) : null}

        {see("products.view") ? (
          <Panel
            title="Product sales"
            description="Units sold per bucket"
            bodyClassName="p-0"
            viewAllHref={reportHrefFor("products")}
            viewAllLabel="View report"
          >
            <Suspense fallback={<ChartSkeleton height={200} />}>
              <UnitsChartPanel range={range} />
            </Suspense>
          </Panel>
        ) : null}
      </div>

      {/* Category mix + leaderboards ---------------------------------------- */}
      <div className="grid gap-3 xl:grid-cols-3">
        {see("products.view") ? (
          <>
            <Panel
              title="Sales by category"
              description="Root categories, by item revenue"
              bodyClassName="p-0"
              viewAllHref={reportHrefFor("categories")}
              viewAllLabel="View report"
            >
              <Suspense fallback={<ChartSkeleton height={240} />}>
                <CategorySalesPanel range={range} />
              </Suspense>
            </Panel>

            <Panel
              title="Top-selling products"
              description="By units in the selected period"
              bodyClassName="p-0"
              viewAllHref={reportHrefFor("products") ?? ("/admin/products" as Route)}
              viewAllLabel={reportHrefFor("products") ? "View report" : "View all"}
            >
              <Suspense fallback={<ListSkeleton rows={6} />}>
                <TopProductsListPanel range={range} />
              </Suspense>
            </Panel>
          </>
        ) : null}

        {see("sellers.view") ? (
          <Panel
            title="Top sellers"
            description="Gross sales and what is payable to them"
            bodyClassName="p-0"
            viewAllHref={reportHrefFor("sellers") ?? ("/admin/sellers" as Route)}
            viewAllLabel={reportHrefFor("sellers") ? "View report" : "View all"}
          >
            <Suspense fallback={<ListSkeleton rows={6} />}>
              <TopSellersListPanel range={range} />
            </Suspense>
          </Panel>
        ) : null}
      </div>

      {/* Recent rows --------------------------------------------------------- */}
      <div className="grid gap-3 xl:grid-cols-3">
        {seeOrders ? (
          <Panel
            title="Recent orders"
            className="xl:col-span-2"
            bodyClassName="p-0"
            viewAllHref={"/admin/orders" as Route}
          >
            <Suspense fallback={<ListSkeleton rows={8} />}>
              <RecentOrdersListPanel />
            </Suspense>
          </Panel>
        ) : null}

        {see("customers.view") ? (
          <Panel
            title="Recent customers"
            bodyClassName="p-0"
            viewAllHref={"/admin/customers" as Route}
          >
            <Suspense fallback={<ListSkeleton rows={6} />}>
              <RecentCustomersListPanel />
            </Suspense>
          </Panel>
        ) : null}
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        {see("sellers.view") ? (
          <Panel
            title="Recent seller registrations"
            description="Newest first; pending ones need a decision"
            bodyClassName="p-0"
            viewAllHref={"/admin/sellers?status=PENDING" as Route}
            viewAllLabel="Approvals"
          >
            <Suspense fallback={<ListSkeleton rows={6} />}>
              <RecentSellersListPanel />
            </Suspense>
          </Panel>
        ) : null}

        {see("reviews.view") ? (
          <Panel
            title="Recent reviews"
            description="Pending first - they are hidden until approved"
            bodyClassName="p-0"
            viewAllHref={"/admin/reviews?status=PENDING" as Route}
            viewAllLabel="Moderate"
          >
            <Suspense fallback={<ListSkeleton rows={6} />}>
              <RecentReviewsListPanel />
            </Suspense>
          </Panel>
        ) : null}

        {see("audit.view") ? (
          <Panel
            title="Recent activity"
            description="The last 15 audited admin actions"
            bodyClassName="p-0"
            viewAllHref={"/admin/audit-log" as Route}
          >
            <Suspense fallback={<ListSkeleton rows={6} />}>
              <ActivityListPanel />
            </Suspense>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
