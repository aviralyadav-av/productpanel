import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ban, PackageX } from "lucide-react";

import { requireAdmin } from "@/lib/auth/guards";
import { getOrderDetail } from "@/features/orders/queries";
import { OrderStatusActions } from "@/features/orders/components/order-status-actions";
import { OrderTimeline } from "@/features/orders/components/order-timeline";
import {
  CustomerCard,
  OrderMoneySummary,
  PaymentCard,
  ShippingAddressCard,
} from "@/features/orders/components/order-summary";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { ProductThumb } from "@/components/shared/product-thumb";
import {
  DataTable,
  DataTableBody,
  DataTableHead,
  Td,
  Th,
  Tr,
} from "@/components/shared/data-table";
import {
  OrderStatusBadge,
  PaymentStatusBadge,
} from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { formatIstDateTime } from "@/lib/dates";
import { discountPercentage, formatNumber, formatPaise } from "@/lib/money";
import type { OrderStatus } from "@/lib/enums";

export async function generateMetadata({
  params,
}: PageProps<"/orders/[id]">): Promise<Metadata> {
  const { id } = await params;
  const order = await getOrderDetail(id);
  return { title: order ? `Order ${order.orderNumber}` : "Order not found" };
}

export default async function OrderDetailPage({
  params,
}: PageProps<"/orders/[id]">) {
  await requireAdmin();
  const { id } = await params;

  const order = await getOrderDetail(id);
  if (!order) notFound();

  const units = order.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title={order.orderNumber}
        description={
          <>
            Placed {formatIstDateTime(order.placedAt)} IST ·{" "}
            {order.source === "STOREFRONT"
              ? "from the storefront"
              : "entered manually"}{" "}
            · {formatNumber(order.items.length)} line
            {order.items.length === 1 ? "" : "s"}, {formatNumber(units)} unit
            {units === 1 ? "" : "s"}
            {order.legacyDateString
              ? ` · imported as "${order.legacyDateString}"`
              : ""}
          </>
        }
        actions={
          <>
            <OrderStatusBadge status={order.status} />
            <PaymentStatusBadge
              status={order.paymentStatus}
              method={order.paymentMethod}
            />
            <Button asChild variant="ghost" size="xs">
              <Link href={"/orders" as never}>
                <ArrowLeft />
                All orders
              </Link>
            </Button>
          </>
        }
      >
        <div className="surface space-y-2 p-3">
          <OrderStatusActions
            orderId={order.id}
            status={order.status as OrderStatus}
          />

          {order.cancelReason ? (
            <p className="text-destructive flex items-start gap-1.5 text-[11px] leading-relaxed">
              <Ban className="mt-0.5 size-3 shrink-0" />
              Cancelled
              {order.cancelledAt
                ? ` ${formatIstDateTime(order.cancelledAt)}`
                : ""}{" "}
              · {order.cancelReason}
            </p>
          ) : null}

          <p className="text-muted-foreground text-[11px] leading-relaxed">
            Status changes are recorded here and in the timeline below. The
            customer sees none of it: the storefront reads its order history
            from the shopper&apos;s own browser and this project sends no
            transactional email.
          </p>
        </div>
      </PageHeader>

      <div className="grid gap-3 xl:grid-cols-3">
        {/* Left: what was bought and what it cost. */}
        <div className="space-y-3 xl:col-span-2">
          <Panel
            title="Items"
            description="Prices are the snapshot taken when the order was placed"
            bodyClassName="p-0"
          >
            {order.items.length === 0 ? (
              <EmptyState
                compact
                icon={PackageX}
                title="This order has no line items"
                description="Nothing was recorded against it. That normally means the order was imported from a source that carried only a total."
              />
            ) : (
              <DataTable>
                <DataTableHead>
                  <Th>Product</Th>
                  <Th>Variant</Th>
                  <Th>SKU</Th>
                  <Th align="right">Unit price</Th>
                  <Th align="right">Qty</Th>
                  <Th align="right">Line total</Th>
                </DataTableHead>

                <DataTableBody>
                  {order.items.map((item) => {
                    const discount = discountPercentage(
                      item.listPricePaise,
                      item.unitPricePaise,
                    );

                    return (
                      <Tr key={item.id}>
                        <Td>
                          <div className="flex items-center gap-2.5">
                            <ProductThumb
                              src={item.imageUrl}
                              alt={item.title}
                              size={36}
                            />
                            <div className="min-w-0">
                              {item.productId && item.productStillExists ? (
                                <Link
                                  href={`/products/${item.productId}` as never}
                                  className="font-medium hover:underline"
                                >
                                  {item.title}
                                </Link>
                              ) : (
                                <p className="font-medium">{item.title}</p>
                              )}
                              {item.productStillExists ? null : (
                                <p className="text-muted-foreground text-[11px]">
                                  No longer in the catalogue
                                </p>
                              )}
                            </div>
                          </div>
                        </Td>

                        <Td className="text-muted-foreground">
                          {item.variantName ?? "—"}
                        </Td>

                        <Td className="text-muted-foreground font-mono text-[11px]">
                          {item.sku ?? "—"}
                        </Td>

                        <Td numeric align="right">
                          {formatPaise(item.unitPricePaise)}
                          {discount > 0 ? (
                            <p className="text-muted-foreground text-[11px]">
                              <s>{formatPaise(item.listPricePaise)}</s> −
                              {discount}%
                            </p>
                          ) : null}
                        </Td>

                        <Td numeric align="right">
                          {formatNumber(item.quantity)}
                        </Td>

                        <Td numeric align="right" className="font-medium">
                          {formatPaise(item.lineTotalPaise)}
                        </Td>
                      </Tr>
                    );
                  })}
                </DataTableBody>
              </DataTable>
            )}

            <OrderMoneySummary order={order} />
          </Panel>
        </div>

        {/* Right: who it goes to and how it was paid for. */}
        <div className="space-y-3">
          <CustomerCard order={order} />
          <ShippingAddressCard order={order} />
          <PaymentCard order={order} />
        </div>
      </div>

      <Panel
        title="Timeline"
        description="Append-only. Every status change, payment, refund and note, oldest first."
        bodyClassName="p-0"
      >
        <OrderTimeline orderId={order.id} events={order.events} />
      </Panel>
    </div>
  );
}
