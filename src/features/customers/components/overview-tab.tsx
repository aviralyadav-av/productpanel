import Link from "next/link";
import type { Route } from "next";
import { ShoppingBag } from "lucide-react";

import { Sparkline } from "@/components/charts/sparkline";
import { EmptyState } from "@/components/shared/empty-state";
import { KeyValueList } from "@/components/shared/key-value-list";
import { Panel } from "@/components/shared/panel";
import { StatCard } from "@/components/shared/stat-card";
import { formatIstDate, formatIstDateTime } from "@/lib/dates";
import { CUSTOMER_SEGMENT_META } from "@/lib/enums";
import { formatNumber, formatPaise } from "@/lib/money";

import { SegmentBadge } from "@/features/customers/components/customer-list";
import { OrdersTable } from "@/features/customers/components/history-tabs";
import type { CustomerDetail, CustomerOverview } from "@/features/customers/queries";

/**
 * The Overview tab: lifetime KPIs, a 12-month spend sparkline, the last five
 * orders and the at-a-glance profile facts. Everything here is read from the
 * counters on the row (C7) plus one small orders query.
 */
export function OverviewTab({ customer, overview }: { customer: CustomerDetail; overview: CustomerOverview }) {
  const spend = overview.monthlySpend.map((bucket) => bucket.paise);
  const yearTotal = spend.reduce((sum, value) => sum + value, 0);
  const address = overview.defaultAddress;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Orders" value={formatNumber(customer.orderCount)} hint={customer.firstOrderAt ? `First ${formatIstDate(customer.firstOrderAt)}` : "No orders yet"} href={`/admin/customers/${customer.id}?tab=orders` as Route} />
        <StatCard label="Total spent" value={formatPaise(customer.totalSpentPaise)} hint="Net of refunds" />
        <StatCard label="Average order" value={formatPaise(customer.averageOrderValuePaise)} hint="Lifetime average" />
        <StatCard label="Last order" value={customer.lastOrderAt ? formatIstDate(customer.lastOrderAt) : "—"} hint={customer.lastLoginAt ? `Last login ${formatIstDate(customer.lastLoginAt)}` : "Never logged in"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Spend, last 12 months" description={`${formatPaise(yearTotal)} across ${overview.monthlySpend.reduce((sum, bucket) => sum + bucket.orders, 0)} order(s)`} className="lg:col-span-2" bodyClassName="p-4">
          {yearTotal === 0 ? (
            <EmptyState compact title="No spend in the last year" description="The sparkline fills in as orders are delivered." />
          ) : (
            <div className="flex flex-col gap-3">
              <Sparkline values={spend} valueFormat="money" width="100%" height={72} label="Monthly spend" />
              <ol className="text-muted-foreground grid grid-cols-6 gap-1 text-[10px] md:grid-cols-12">
                {overview.monthlySpend.map((bucket) => (
                  <li key={bucket.month} className="flex flex-col items-center">
                    <span data-numeric className="text-foreground">
                      {bucket.paise > 0 ? formatPaise(bucket.paise).replace(/\.\d+$/, "") : "·"}
                    </span>
                    <span>{formatIstDate(new Date(`${bucket.month}-01T00:00:00+05:30`)).split(" ")[1]}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Panel>

        <Panel title="Profile" bodyClassName="p-4">
          <KeyValueList
            dense
            items={[
              { label: "Email", value: customer.email },
              { label: "Phone", value: customer.phone ?? "—" },
              { label: "Member since", value: formatIstDateTime(customer.createdAt) },
              { label: "Email verified", value: customer.emailVerifiedAt ? formatIstDate(customer.emailVerifiedAt) : "No" },
              { label: "Marketing", value: customer.acceptsMarketing ? "Opted in" : "Not opted in" },
              {
                label: "Segments",
                value: customer.segments.length ? (
                  <span className="flex flex-wrap gap-1">
                    {customer.segments.map((segment) => (
                      <SegmentBadge key={segment} segment={segment} />
                    ))}
                  </span>
                ) : (
                  "—"
                ),
              },
              { label: "Tags", value: customer.tags.length ? customer.tags.join(", ") : "—", wide: true },
              {
                label: "Default address",
                value: address ? `${address.line1}, ${address.city}, ${address.state} ${address.pinCode}` : "—",
                wide: true,
              },
            ]}
          />
        </Panel>
      </div>

      <Panel title="Recent orders" viewAllHref={`/admin/customers/${customer.id}?tab=orders` as Route}>
        {overview.recentOrders.length === 0 ? (
          <EmptyState compact icon={ShoppingBag} title="No orders yet" description="Orders placed on the website with this email appear here." />
        ) : (
          <OrdersTable rows={overview.recentOrders} />
        )}
      </Panel>

      {customer.notes ? (
        <Panel title="Staff notes" description="Internal - never shown to the customer" bodyClassName="p-4">
          <p className="text-sm whitespace-pre-wrap">{customer.notes}</p>
        </Panel>
      ) : null}

      <p className="text-muted-foreground text-[11px]">
        Segments use the thresholds in Settings → Customers: new within {customer.thresholds.newDays} days, returning from {customer.thresholds.returningMinOrders} orders, VIP from{" "}
        {customer.thresholds.vipMinOrders} orders, high value from {formatPaise(customer.thresholds.highValueMinSpendPaise)}, inactive after {customer.thresholds.inactiveDays} days without an order.
        {customer.segment ? ` Primary badge: ${CUSTOMER_SEGMENT_META[customer.segment].label}.` : ""}
        <Link href={"/admin/settings?tab=customers" as Route} className="ml-1 underline">
          Adjust
        </Link>
      </p>
    </div>
  );
}
