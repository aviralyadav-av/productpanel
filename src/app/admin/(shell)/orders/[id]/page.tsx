import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { can, requirePermission } from "@/lib/auth/guards";
import {
  FULFILLMENT_STATUS_META,
  ORDER_RETURN_STATUS_META,
  ORDER_SOURCE_META,
  type FulfillmentStatus,
  type OrderReturnStatus,
  type OrderSource,
} from "@/lib/enums";
import { formatIstDateTime } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { OrderStatusBadge, PaymentStatusBadge, StatusPill } from "@/components/shared/status-badge";

import { getOrderDetail, listOrderActivity } from "@/features/orders/detail-queries";
import { listShipmentPartners } from "@/features/orders/queries";
import { OrderAddressesCard } from "@/features/orders/components/order-address-card";
import { OrderHeaderActions } from "@/features/orders/components/order-header-actions";
import { OrderItemsCard } from "@/features/orders/components/order-items-card";
import { OrderMoneyCard } from "@/features/orders/components/order-money-card";
import { OrderPaymentsCard } from "@/features/orders/components/order-payments-card";
import { OrderShipmentsCard } from "@/features/orders/components/order-shipments-card";
import {
  OrderActivityCard,
  OrderCustomerCard,
  OrderRefundsCard,
  OrderReturnsCard,
  OrderSellerSplitCard,
} from "@/features/orders/components/order-side-cards";
import { OrderTimelineCard } from "@/features/orders/components/order-timeline-card";
import type { OrderPermissions } from "@/features/orders/detail-types";

export const metadata: Metadata = { title: "Order" };

const EDITABLE_SHIPPING: readonly string[] = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED"];
const CLOSED: readonly string[] = ["CANCELLED", "FAILED", "REFUNDED"];

/**
 * /admin/orders/[id] (blueprint §8, §14.C1, C2, C8, B1, B3, B6, D13).
 *
 * One screen holds the whole order because that is how a support call works:
 * the operator has the customer on the phone and needs the lines with their
 * personalisation, the money, the payments, the shipments, the returns and
 * who changed what - without clicking through tabs while the customer waits.
 * Everything mutable is a client island; everything else renders on the
 * server so the page stays cheap.
 */
export default async function OrderDetailPage({ params }: PageProps<"/admin/orders/[id]">) {
  const actor = await requirePermission("orders.view");
  const { id } = await params;

  const order = await getOrderDetail(id);
  if (!order) notFound();

  const [partners, activity] = await Promise.all([
    listShipmentPartners(),
    listOrderActivity(order.id, order.shipments.map((shipment) => shipment.id)),
  ]);

  const permissions: OrderPermissions = {
    update: can(actor, "orders.update"),
    cancel: can(actor, "orders.cancel"),
    notes: can(actor, "orders.notes"),
    ship: can(actor, "orders.ship"),
    payments: can(actor, "payments.manage"),
    refunds: can(actor, "refunds.view"),
    returns: can(actor, "returns.view"),
  };

  const outstandingPaise = order.balanceDuePaise;
  const source = ORDER_SOURCE_META[order.source as OrderSource];
  const fulfillment = FULFILLMENT_STATUS_META[order.fulfillmentStatus as FulfillmentStatus];
  const returnMeta = ORDER_RETURN_STATUS_META[order.returnStatus as OrderReturnStatus];

  return (
    <div className="space-y-4">
      <PageHeader
        title={order.orderNumber}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Placed {formatIstDateTime(order.placedAt)}</span>
            {order.confirmedAt ? <span>Confirmed {formatIstDateTime(order.confirmedAt)}</span> : null}
            {order.shippedAt ? <span>Shipped {formatIstDateTime(order.shippedAt)}</span> : null}
            {order.deliveredAt ? <span>Delivered {formatIstDateTime(order.deliveredAt)}</span> : null}
            {order.cancelledAt ? <span>Cancelled {formatIstDateTime(order.cancelledAt)}{order.cancelReason ? ` — ${order.cancelReason}` : ""}</span> : null}
            {order.reservationExpiresAt && order.status === "PENDING" ? (
              <span>Reservation holds until {formatIstDateTime(order.reservationExpiresAt)}</span>
            ) : null}
          </span>
        }
        actions={
          <OrderHeaderActions
            orderId={order.id}
            orderNumber={order.orderNumber}
            status={order.status}
            items={order.items}
            partners={partners}
            outstandingPaise={outstandingPaise}
            paymentMethod={order.paymentMethod}
            permissions={permissions}
          />
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="xs" variant="ghost">
            <Link href={"/admin/orders" as Route}>
              <ArrowLeft /> All orders
            </Link>
          </Button>
          <OrderStatusBadge status={order.status} />
          <PaymentStatusBadge status={order.paymentStatus} method={order.paymentMethod} />
          {fulfillment ? <StatusPill label={fulfillment.label} tone={fulfillment.tone} /> : null}
          {order.returnStatus !== "NONE" && returnMeta ? <StatusPill label={`Returns: ${returnMeta.label}`} tone={returnMeta.tone} /> : null}
          {source ? <StatusPill label={source.label} tone={source.tone} dot={false} /> : null}
        </div>
      </PageHeader>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <OrderItemsCard orderId={order.id} items={order.items} canCancelLines={permissions.cancel && EDITABLE_SHIPPING.includes(order.status)} />

          <OrderShipmentsCard
            orderId={order.id}
            shipments={order.shipments}
            items={order.items}
            partners={partners}
            canShip={permissions.ship}
          />

          <OrderPaymentsCard
            orderId={order.id}
            payments={order.payments}
            paidPaise={order.paidPaise}
            outstandingPaise={outstandingPaise}
            paymentMethod={order.paymentMethod}
            canRecord={permissions.payments}
          />

          <OrderAddressesCard
            orderId={order.id}
            shippingAddress={order.shippingAddress}
            billingAddress={order.billingAddress}
            canEditShipping={permissions.update && EDITABLE_SHIPPING.includes(order.status)}
            canEditBilling={permissions.update && !CLOSED.includes(order.status)}
          />

          <OrderTimelineCard orderId={order.id} events={order.events} canAddNotes={permissions.notes} />
        </div>

        <div className="min-w-0 space-y-4">
          <OrderMoneyCard
            order={{
              subtotalPaise: order.subtotalPaise,
              discountPaise: order.discountPaise,
              couponDiscountPaise: order.couponDiscountPaise,
              couponCode: order.couponCode,
              couponId: order.couponId,
              shippingPaise: order.shippingPaise,
              shippingMethodName: order.shippingMethodName,
              codFeePaise: order.codFeePaise,
              taxPaise: order.taxPaise,
              totalPaise: order.totalPaise,
              refundedPaise: order.refundedPaise,
              paidPaise: order.paidPaise,
              balanceDuePaise: order.balanceDuePaise,
              pricesIncludeTax: order.pricesIncludeTax,
              taxRemittedBy: order.taxRemittedBy,
              currency: order.currency,
            }}
          />

          <OrderCustomerCard
            customerId={order.customer?.id ?? null}
            name={order.customerName}
            email={order.customerEmail}
            phone={order.customer?.phone ?? order.shippingAddress?.phone ?? null}
            isGuest={order.isGuest}
            orderCount={order.customer?.orderCount ?? null}
            totalSpentPaise={order.customer?.totalSpentPaise ?? null}
            customerNote={order.customerNote}
            source={order.source}
            createdByName={order.createdBy?.name ?? order.createdBy?.email ?? null}
          />

          <OrderSellerSplitCard split={order.sellerSplit} />

          {permissions.returns ? <OrderReturnsCard returns={order.returnRequests} /> : null}
          {permissions.refunds ? <OrderRefundsCard refunds={order.refunds} /> : null}

          <OrderActivityCard rows={activity} />
        </div>
      </div>
    </div>
  );
}
