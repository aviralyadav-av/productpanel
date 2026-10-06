import "server-only";

import { writeAudit, type AuditActor } from "@/lib/audit";
import { exportRows, paginateAll, type ExportColumn, type ExportFormat } from "@/lib/export";

import { pageOrdersForExport } from "./queries";
import type { OrderListFilters } from "./schemas";

/**
 * Order export (blueprint §11.28, D13). Rows stream in pages so a 50,000-order
 * export never materialises in memory, and the audit row records the filter
 * plus the row count - the two facts a later question about "who downloaded
 * customer data" needs to be answerable.
 */

export const ORDER_EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: "orderNumber", label: "Order" },
  { key: "placedAt", label: "Placed", type: "date" },
  { key: "status", label: "Status" },
  { key: "paymentStatus", label: "Payment status" },
  { key: "paymentMethod", label: "Payment method" },
  { key: "source", label: "Source" },
  { key: "customerName", label: "Customer" },
  { key: "customerEmail", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "pinCode", label: "PIN code" },
  { key: "items", label: "Units", type: "number" },
  { key: "sellers", label: "Sellers" },
  { key: "subtotalPaise", label: "Subtotal", type: "money" },
  { key: "discountPaise", label: "Promotion discount", type: "money" },
  { key: "couponCode", label: "Coupon" },
  { key: "couponDiscountPaise", label: "Coupon discount", type: "money" },
  { key: "shippingPaise", label: "Shipping", type: "money" },
  { key: "codFeePaise", label: "COD fee", type: "money" },
  { key: "taxPaise", label: "Tax", type: "money" },
  { key: "totalPaise", label: "Total", type: "money" },
  { key: "refundedPaise", label: "Refunded", type: "money" },
  { key: "shippingStatus", label: "Shipment status" },
  { key: "trackingNumber", label: "Tracking" },
];

export async function exportOrders(input: {
  format: ExportFormat;
  filters: OrderListFilters;
  q: string;
  actor: AuditActor;
  ip?: string | null;
}): Promise<Response> {
  const { format, filters, q, actor, ip } = input;
  return exportRows({
    format,
    filename: `orders-${new Date().toISOString().slice(0, 10)}`,
    title: "Orders",
    columns: ORDER_EXPORT_COLUMNS,
    rows: paginateAll((skip, take) => pageOrdersForExport(filters, q, skip, take)),
    onComplete: (rowCount) =>
      writeAudit({
        actor,
        action: "order.export",
        entityType: "Order",
        summary: `Exported ${rowCount} order${rowCount === 1 ? "" : "s"} as ${format.toUpperCase()}.`,
        diff: { filters: JSON.parse(JSON.stringify({ ...filters, q })), rowCount },
        ip: ip ?? null,
      }),
  });
}
