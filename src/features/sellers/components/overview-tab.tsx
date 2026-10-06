import Link from "next/link";
import type { Route } from "next";
import { Inbox } from "lucide-react";

import { formatIstDate, formatIstDateTime } from "@/lib/dates";
import { formatNumber, formatPaise } from "@/lib/money";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { KeyValueList } from "@/components/shared/key-value-list";
import { Panel } from "@/components/shared/panel";
import { StatCard } from "@/components/shared/stat-card";
import { OrderStatusBadge } from "@/components/shared/status-badge";
import { StatusTimeline } from "@/components/shared/status-timeline";

import { RatingText, SellerStatusBadge } from "@/features/sellers/components/badges";
import { maskGstin, maskPan } from "@/features/sellers/schemas";
import type { SellerDetail, SellerOverview } from "@/features/sellers/types";

/** Overview tab: the numbers an operator checks first, then what happened last. */
export function OverviewTab({ seller, overview }: { seller: SellerDetail; overview: SellerOverview }) {
  const payable = seller.balance.availablePaise + seller.balance.scheduledPaise;
  return (
    <div className="space-y-4">
      <section aria-label="Seller metrics" className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatCard label="Gross sales" value={formatPaise(seller.grossSalesPaise)} hint={`${formatNumber(seller.orderItemCount)} items delivered`} />
        <StatCard
          label="Products"
          value={formatNumber(seller.productCount)}
          hint={`${formatNumber(seller.publishedProductCount)} published`}
          href={`/admin/sellers/${seller.id}?tab=products` as Route}
        />
        <StatCard
          label="Payable"
          value={formatPaise(payable)}
          hint={seller.balance.pendingPaise > 0 ? `${formatPaise(seller.balance.pendingPaise)} on hold` : `${formatPaise(seller.balance.paidPaise)} paid to date`}
          href={`/admin/sellers/${seller.id}?tab=earnings` as Route}
        />
        <StatCard
          label="Rating"
          value={seller.reviewCount > 0 ? seller.ratingAvg.toFixed(1) : "—"}
          hint={`${formatNumber(overview.reviews.approved)} approved · ${formatNumber(overview.reviews.pending)} pending`}
          href={`/admin/sellers/${seller.id}?tab=reviews` as Route}
        />
        <StatCard label="Returns" value={formatNumber(overview.returns)} hint="Return requests on this seller's lines" higherIsBetter={false} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Recent order lines" description="Latest lines sold by this seller" viewAllHref={`/admin/sellers/${seller.id}?tab=orders` as Route} className="lg:col-span-2" bodyClassName="p-0">
          {overview.recentItems.length === 0 ? (
            <EmptyState icon={Inbox} title="No orders yet" description="Order lines appear here once a customer buys one of this seller's products." compact />
          ) : (
            <div className="overflow-x-auto">
              <DataTable>
                <DataTableHead>
                  <Th>Order</Th>
                  <Th>Item</Th>
                  <Th align="right">Qty</Th>
                  <Th align="right">Line total</Th>
                  <Th>Status</Th>
                </DataTableHead>
                <DataTableBody>
                  {overview.recentItems.map((item) => (
                    <Tr key={item.id}>
                      <Td>
                        <Link href={`/admin/orders/${item.orderId}` as Route} className="font-mono text-xs hover:underline">
                          {item.orderNumber}
                        </Link>
                        <span className="text-muted-foreground block text-[11px]">{formatIstDate(new Date(item.placedAt))}</span>
                      </Td>
                      <Td className="max-w-[16rem] text-xs">
                        <span className="block truncate">{item.title}</span>
                        {item.variant ? <span className="text-muted-foreground block truncate text-[11px]">{item.variant}</span> : null}
                      </Td>
                      <Td align="right" numeric className="text-xs">
                        {item.quantity}
                      </Td>
                      <Td align="right" numeric className="text-xs">
                        {formatPaise(item.lineTotalPaise)}
                      </Td>
                      <Td>
                        <OrderStatusBadge status={item.orderStatus} />
                      </Td>
                    </Tr>
                  ))}
                </DataTableBody>
              </DataTable>
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="Business" bodyClassName="p-4">
            <KeyValueList
              dense
              items={[
                { label: "Status", value: <SellerStatusBadge status={seller.status} /> },
                { label: "Owner", value: seller.ownerName },
                { label: "Legal name", value: seller.legalName ?? "—" },
                { label: "GSTIN", value: <span className="font-mono">{maskGstin(seller.gstin) ?? "—"}</span> },
                { label: "PAN", value: <span className="font-mono">{maskPan(seller.pan) ?? "—"}</span> },
                { label: "Location", value: [seller.city, seller.state].filter(Boolean).join(", ") || "—" },
                { label: "Rating", value: <RatingText avg={seller.ratingAvg} count={seller.reviewCount} /> },
                { label: "Last active", value: seller.lastActiveAt ? formatIstDateTime(new Date(seller.lastActiveAt)) : "—" },
                { label: "Login", value: seller.hasPassword ? "Password set" : "No password yet (send a reset link)" },
              ]}
            />
          </Panel>

          <Panel title="Recent events" viewAllHref={`/admin/sellers/${seller.id}?tab=activity` as Route} bodyClassName="p-4">
            <StatusTimeline
              events={overview.recentEvents.map((event) => ({
                id: event.id,
                title: event.toStatus && event.fromStatus !== event.toStatus ? `${event.fromStatus ?? "New"} → ${event.toStatus}` : event.message,
                description: event.toStatus && event.fromStatus !== event.toStatus ? event.message : undefined,
                at: new Date(event.createdAt),
                actor: event.actor,
              }))}
              emptyText="No events recorded."
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
