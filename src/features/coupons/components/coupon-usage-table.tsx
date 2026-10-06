import Link from "next/link";
import type { Route } from "next";
import { Receipt } from "lucide-react";

import { formatIstDateTime } from "@/lib/dates";
import { ORDER_STATUS_META, type OrderStatus } from "@/lib/enums";
import type { PageMeta } from "@/lib/list-params";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PaginationBar } from "@/components/shared/list-controls";
import { PriceText } from "@/components/shared/price-text";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { StatusPill } from "@/components/shared/status-badge";

import type { CouponUsageRow } from "../schemas";

/** Redemption history for one coupon - a Server Component, nothing to click but the order links. */
export function CouponUsageTable({ rows, meta }: { rows: CouponUsageRow[]; meta: PageMeta }) {
  if (rows.length === 0) {
    return (
      <div className="surface">
        <EmptyState icon={Receipt} title="No redemptions yet" description="Every order that applies this coupon will be listed here with the discount it received." compact />
      </div>
    );
  }

  const orderHref = (id: string) => `/admin/orders/${id}` as Route;
  const statusPill = (status: string | null) => {
    const meta = status ? ORDER_STATUS_META[status as OrderStatus] : undefined;
    return meta ? <StatusPill label={meta.label} tone={meta.tone} /> : <span className="text-muted-foreground">—</span>;
  };

  const table = (
    <DataTable>
      <DataTableHead>
        <Th>Order</Th>
        <Th>Customer</Th>
        <Th>Status</Th>
        <Th align="right">Discount</Th>
        <Th>Redeemed</Th>
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.id}>
            <Td>
              <Link href={orderHref(row.orderId)} className="font-mono text-xs font-semibold hover:underline">
                {row.orderNumber ?? row.orderId}
              </Link>
            </Td>
            <Td>
              {row.customerId ? (
                <Link href={`/admin/customers/${row.customerId}` as Route} className="hover:underline">
                  {row.customerName ?? row.customerEmail ?? "Customer"}
                </Link>
              ) : (
                <span>{row.customerEmail ?? "Guest"}</span>
              )}
              {row.customerName && row.customerEmail ? <span className="text-muted-foreground block text-xs">{row.customerEmail}</span> : null}
            </Td>
            <Td>{statusPill(row.orderStatus)}</Td>
            <Td align="right" numeric>
              <PriceText paise={row.discountPaise} />
            </Td>
            <Td className="whitespace-nowrap">{formatIstDateTime(row.createdAt)}</Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = (
    <div className="space-y-2">
      {rows.map((row) => (
        <MobileCard key={row.id} title={row.orderNumber ?? row.orderId} subtitle={row.customerName ?? row.customerEmail ?? "Guest"} meta={statusPill(row.orderStatus)} href={orderHref(row.orderId)}>
          <MobileCardField label="Discount" numeric>
            <PriceText paise={row.discountPaise} />
          </MobileCardField>
          <MobileCardField label="Redeemed">{formatIstDateTime(row.createdAt)}</MobileCardField>
        </MobileCard>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="surface overflow-hidden">
        <ResponsiveTable table={table} cards={cards} />
      </div>
      <PaginationBar meta={meta} itemLabel="redemptions" />
    </div>
  );
}
