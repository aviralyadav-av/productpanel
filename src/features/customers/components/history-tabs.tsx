import Link from "next/link";
import type { Route } from "next";
import { CreditCard, RotateCcw, ShoppingBag, Undo2 } from "lucide-react";

import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PaginationBar } from "@/components/shared/list-controls";
import { PriceText } from "@/components/shared/price-text";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { OrderStatusBadge, PaymentStatusBadge, StatusPill } from "@/components/shared/status-badge";
import { formatIstDate, formatIstDateTime } from "@/lib/dates";
import {
  FULFILLMENT_STATUS_META,
  PAYMENT_TRANSACTION_STATUS_META,
  REFUND_METHOD_META,
  REFUND_STATUS_META,
  RETURN_REASON_META,
  RETURN_REQUEST_STATUS_META,
  type FulfillmentStatus,
  type PaymentTransactionStatus,
  type RefundMethod,
  type RefundStatus,
  type ReturnReason,
  type ReturnRequestStatus,
} from "@/lib/enums";
import type { PageMeta } from "@/lib/list-params";
import { formatNumber } from "@/lib/money";

import type { CustomerOrderRow, CustomerPaymentRow, CustomerRefundRow, CustomerReturnRow } from "@/features/customers/queries";

/**
 * Money-history tabs of the customer profile: orders, payments, returns,
 * refunds. Read-only tables that link into the owning module; every row has
 * a mobile card twin so the profile stays usable on a phone.
 */

export function OrdersTable({ rows, meta }: { rows: CustomerOrderRow[]; meta?: PageMeta }) {
  return (
    <>
      <ResponsiveTable
        table={
          <DataTable>
            <DataTableHead>
              <Th>Order</Th>
              <Th>Placed</Th>
              <Th>Status</Th>
              <Th>Payment</Th>
              <Th>Fulfilment</Th>
              <Th align="right">Items</Th>
              <Th align="right">Total</Th>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => {
                const fulfilment = FULFILLMENT_STATUS_META[row.fulfillmentStatus as FulfillmentStatus];
                return (
                  <Tr key={row.id}>
                    <Td>
                      <Link href={`/admin/orders/${row.id}` as Route} className="font-mono text-xs font-medium hover:underline">
                        {row.orderNumber}
                      </Link>
                    </Td>
                    <Td className="text-muted-foreground text-xs whitespace-nowrap">{formatIstDateTime(row.placedAt)}</Td>
                    <Td>
                      <OrderStatusBadge status={row.status} />
                    </Td>
                    <Td>
                      <PaymentStatusBadge status={row.paymentStatus} method={row.paymentMethod} />
                    </Td>
                    <Td>
                      <StatusPill label={fulfilment?.label ?? row.fulfillmentStatus} tone={fulfilment?.tone ?? "neutral"} />
                    </Td>
                    <Td align="right" numeric>
                      {formatNumber(row._count.items)}
                    </Td>
                    <Td align="right" numeric>
                      <PriceText paise={row.totalPaise} />
                      {row.refundedPaise > 0 ? (
                        <div className="text-muted-foreground text-[11px]">
                          −<PriceText paise={row.refundedPaise} /> refunded
                        </div>
                      ) : null}
                    </Td>
                  </Tr>
                );
              })}
            </DataTableBody>
          </DataTable>
        }
        cards={rows.map((row) => (
          <MobileCard key={row.id} href={`/admin/orders/${row.id}`} title={row.orderNumber} subtitle={formatIstDateTime(row.placedAt)} meta={<OrderStatusBadge status={row.status} />}>
            <MobileCardField label="Total" numeric>
              <PriceText paise={row.totalPaise} />
            </MobileCardField>
            <MobileCardField label="Payment">
              <PaymentStatusBadge status={row.paymentStatus} method={row.paymentMethod} />
            </MobileCardField>
          </MobileCard>
        ))}
      />
      {meta && meta.total > 0 ? <PaginationBar meta={meta} itemLabel="orders" /> : null}
    </>
  );
}

export function OrdersTab({ rows, meta }: { rows: CustomerOrderRow[]; meta: PageMeta }) {
  if (rows.length === 0) {
    return (
      <div className="surface">
        <EmptyState icon={ShoppingBag} title="No orders" description="Orders placed with this account appear here with links into the orders module." />
      </div>
    );
  }
  return (
    <div className="surface overflow-hidden">
      <OrdersTable rows={rows} meta={meta} />
    </div>
  );
}

export function PaymentsTab({ rows }: { rows: CustomerPaymentRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="surface">
        <EmptyState icon={CreditCard} title="No payments" description="Every charge, authorisation and refund transaction across this customer's orders is listed here." />
      </div>
    );
  }
  return (
    <div className="surface overflow-hidden">
      <ResponsiveTable
        table={
          <DataTable>
            <DataTableHead>
              <Th>When</Th>
              <Th>Order</Th>
              <Th>Provider</Th>
              <Th>Method</Th>
              <Th>Type</Th>
              <Th>Status</Th>
              <Th align="right">Amount</Th>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => {
                const status = PAYMENT_TRANSACTION_STATUS_META[row.status as PaymentTransactionStatus];
                return (
                  <Tr key={row.id}>
                    <Td className="text-muted-foreground text-xs whitespace-nowrap">{formatIstDateTime(row.createdAt)}</Td>
                    <Td>
                      <Link href={`/admin/orders/${row.order.id}` as Route} className="font-mono text-xs hover:underline">
                        {row.order.orderNumber}
                      </Link>
                    </Td>
                    <Td className="text-xs">{row.provider}</Td>
                    <Td className="text-xs">{row.method}</Td>
                    <Td className="text-xs">{row.type}</Td>
                    <Td>
                      <StatusPill label={status?.label ?? row.status} tone={status?.tone ?? "neutral"} />
                      {row.failureMessage ? <div className="text-muted-foreground max-w-56 truncate text-[11px]">{row.failureMessage}</div> : null}
                    </Td>
                    <Td align="right" numeric>
                      <PriceText paise={row.type === "REFUND" ? -row.amountPaise : row.amountPaise} signed={row.type === "REFUND"} />
                    </Td>
                  </Tr>
                );
              })}
            </DataTableBody>
          </DataTable>
        }
        cards={rows.map((row) => (
          <MobileCard key={row.id} href={`/admin/orders/${row.order.id}`} title={`${row.provider} · ${row.method}`} subtitle={formatIstDateTime(row.createdAt)} meta={<PriceText paise={row.amountPaise} />}>
            <MobileCardField label="Order">{row.order.orderNumber}</MobileCardField>
            <MobileCardField label="Status">{PAYMENT_TRANSACTION_STATUS_META[row.status as PaymentTransactionStatus]?.label ?? row.status}</MobileCardField>
          </MobileCard>
        ))}
      />
    </div>
  );
}

export function ReturnsTab({ rows }: { rows: CustomerReturnRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="surface">
        <EmptyState icon={Undo2} title="No returns" description="Return requests raised against this customer's orders appear here." />
      </div>
    );
  }
  return (
    <div className="surface overflow-hidden">
      <ResponsiveTable
        table={
          <DataTable>
            <DataTableHead>
              <Th>RMA</Th>
              <Th>Order</Th>
              <Th>Item</Th>
              <Th>Reason</Th>
              <Th>Status</Th>
              <Th>Requested</Th>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => {
                const status = RETURN_REQUEST_STATUS_META[row.status as ReturnRequestStatus];
                const reason = RETURN_REASON_META[row.reason as ReturnReason];
                return (
                  <Tr key={row.id}>
                    <Td>
                      <Link href={`/admin/returns/${row.id}` as Route} className="font-mono text-xs font-medium hover:underline">
                        {row.rmaNumber}
                      </Link>
                    </Td>
                    <Td>
                      <Link href={`/admin/orders/${row.order.id}` as Route} className="font-mono text-xs hover:underline">
                        {row.order.orderNumber}
                      </Link>
                    </Td>
                    <Td className="max-w-64 truncate text-xs">
                      {row.orderItem.titleSnapshot}
                      {row.orderItem.variantSnapshot ? <span className="text-muted-foreground"> · {row.orderItem.variantSnapshot}</span> : null}
                      <span className="text-muted-foreground"> × {row.quantity}</span>
                    </Td>
                    <Td className="text-xs">{reason?.label ?? row.reason}</Td>
                    <Td>
                      <StatusPill label={status?.label ?? row.status} tone={status?.tone ?? "neutral"} />
                    </Td>
                    <Td className="text-muted-foreground text-xs whitespace-nowrap">{formatIstDate(row.requestedAt)}</Td>
                  </Tr>
                );
              })}
            </DataTableBody>
          </DataTable>
        }
        cards={rows.map((row) => (
          <MobileCard key={row.id} href={`/admin/returns/${row.id}`} title={row.rmaNumber} subtitle={row.orderItem.titleSnapshot} meta={<StatusPill label={RETURN_REQUEST_STATUS_META[row.status as ReturnRequestStatus]?.label ?? row.status} tone={RETURN_REQUEST_STATUS_META[row.status as ReturnRequestStatus]?.tone ?? "neutral"} />}>
            <MobileCardField label="Order">{row.order.orderNumber}</MobileCardField>
            <MobileCardField label="Requested">{formatIstDate(row.requestedAt)}</MobileCardField>
          </MobileCard>
        ))}
      />
    </div>
  );
}

export function RefundsTab({ rows }: { rows: CustomerRefundRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="surface">
        <EmptyState icon={RotateCcw} title="No refunds" description="Refunds issued on this customer's orders appear here." />
      </div>
    );
  }
  return (
    <div className="surface overflow-hidden">
      <ResponsiveTable
        table={
          <DataTable>
            <DataTableHead>
              <Th>Refund</Th>
              <Th>Order</Th>
              <Th>RMA</Th>
              <Th>Method</Th>
              <Th>Status</Th>
              <Th>Created</Th>
              <Th align="right">Amount</Th>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => {
                const status = REFUND_STATUS_META[row.status as RefundStatus];
                const method = REFUND_METHOD_META[row.method as RefundMethod];
                return (
                  <Tr key={row.id}>
                    <Td>
                      <Link href={`/admin/refunds/${row.id}` as Route} className="font-mono text-xs font-medium hover:underline">
                        {row.refundNumber}
                      </Link>
                    </Td>
                    <Td>
                      <Link href={`/admin/orders/${row.order.id}` as Route} className="font-mono text-xs hover:underline">
                        {row.order.orderNumber}
                      </Link>
                    </Td>
                    <Td className="text-xs">
                      {row.returnRequest ? (
                        <Link href={`/admin/returns/${row.returnRequest.id}` as Route} className="font-mono hover:underline">
                          {row.returnRequest.rmaNumber}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="text-xs">{method?.label ?? row.method}</Td>
                    <Td>
                      <StatusPill label={status?.label ?? row.status} tone={status?.tone ?? "neutral"} />
                    </Td>
                    <Td className="text-muted-foreground text-xs whitespace-nowrap">{formatIstDate(row.createdAt)}</Td>
                    <Td align="right" numeric>
                      <PriceText paise={row.amountPaise} />
                    </Td>
                  </Tr>
                );
              })}
            </DataTableBody>
          </DataTable>
        }
        cards={rows.map((row) => (
          <MobileCard key={row.id} href={`/admin/refunds/${row.id}`} title={row.refundNumber} subtitle={row.order.orderNumber} meta={<PriceText paise={row.amountPaise} />}>
            <MobileCardField label="Status">{REFUND_STATUS_META[row.status as RefundStatus]?.label ?? row.status}</MobileCardField>
            <MobileCardField label="Created">{formatIstDate(row.createdAt)}</MobileCardField>
          </MobileCard>
        ))}
      />
    </div>
  );
}
