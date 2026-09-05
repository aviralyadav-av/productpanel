import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown, ShoppingCart } from "lucide-react";
import { cn } from "cn";

import {
  DataTable,
  DataTableBody,
  DataTableHead,
  Td,
  Th,
  Tr,
} from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import {
  OrderStatusBadge,
  PaymentStatusBadge,
} from "@/components/shared/status-badge";
import { formatIstDateTime } from "@/lib/dates";
import { formatNumber, formatPaise } from "@/lib/money";
import type { OrderListRow, OrderSortField } from "@/features/orders/queries";

/**
 * A Server Component: sorting is a link that rewrites the URL, so there is no
 * client-side table state to drift out of sync with what the server queried.
 */
export function OrderTable({
  orders,
  sort,
  order,
  query,
  isFiltered,
}: {
  orders: OrderListRow[];
  sort: OrderSortField;
  order: "asc" | "desc";
  /** The current query string, so sort links preserve every other filter. */
  query: string;
  isFiltered: boolean;
}) {
  if (orders.length === 0) {
    return (
      <EmptyState
        icon={ShoppingCart}
        title={isFiltered ? "No orders match these filters" : "No orders yet"}
        description={
          isFiltered
            ? "Clear the search or widen the date range to see more."
            : "The storefront saves orders to the shopper's own browser and never sends them to a server, so none arrive here until its checkout is pointed at this API."
        }
        action={
          isFiltered ? (
            <Link
              href={"/orders" as never}
              className="text-brand text-xs font-medium hover:underline"
            >
              Clear all filters
            </Link>
          ) : null
        }
      />
    );
  }

  return (
    <DataTable>
      <DataTableHead>
        <Th width="14rem">Order</Th>
        <SortableTh
          field="placedAt"
          label="Placed"
          sort={sort}
          order={order}
          query={query}
        />
        <Th>Customer</Th>
        <Th align="right">Items</Th>
        <Th>Payment</Th>
        <Th>Status</Th>
        <SortableTh
          field="totalPaise"
          label="Total"
          align="right"
          sort={sort}
          order={order}
          query={query}
        />
      </DataTableHead>

      <DataTableBody>
        {orders.map((row) => (
          <Tr key={row.id}>
            <Td>
              <Link
                href={`/orders/${row.id}` as never}
                className="font-medium hover:underline"
              >
                {row.orderNumber}
              </Link>
              {row.refundedPaise > 0 ? (
                <p className="text-muted-foreground text-[11px]">
                  {formatPaise(row.refundedPaise)} refunded
                </p>
              ) : null}
            </Td>

            <Td numeric className="text-muted-foreground whitespace-nowrap">
              {formatIstDateTime(row.placedAt)}
            </Td>

            <Td className="max-w-[14rem]">
              <p className="truncate">{row.customerName}</p>
              <p className="text-muted-foreground truncate text-[11px]">
                {[row.city, row.state].filter(Boolean).join(", ") || "—"}
              </p>
            </Td>

            {/* Units, not lines - it is what has to be picked and packed. */}
            <Td numeric align="right">
              {formatNumber(row.units)}
            </Td>

            <Td>
              <PaymentStatusBadge
                status={row.paymentStatus}
                method={row.paymentMethod}
              />
            </Td>

            <Td>
              <OrderStatusBadge status={row.status} />
            </Td>

            <Td numeric align="right" className="font-medium">
              {formatPaise(row.totalPaise)}
            </Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );
}

function SortableTh({
  field,
  label,
  align = "left",
  sort,
  order,
  query,
}: {
  field: OrderSortField;
  label: string;
  align?: "left" | "right";
  sort: OrderSortField;
  order: "asc" | "desc";
  query: string;
}) {
  const isActive = sort === field;
  // Clicking the active column flips it; clicking a new one starts at
  // descending, which is what "most recent" and "biggest" mean.
  const nextOrder = isActive && order === "desc" ? "asc" : "desc";

  const params = new URLSearchParams(query);
  params.set("sort", field);
  params.set("order", nextOrder);
  params.delete("page");

  const Icon = !isActive ? ChevronsUpDown : order === "desc" ? ArrowDown : ArrowUp;

  return (
    <Th align={align}>
      <Link
        href={`/orders?${params.toString()}` as never}
        scroll={false}
        aria-label={`Sort by ${label.toLowerCase()}, ${nextOrder === "asc" ? "ascending" : "descending"}`}
        className={cn(
          "hover:text-foreground inline-flex items-center gap-1 transition-colors",
          align === "right" && "flex-row-reverse",
          isActive && "text-foreground",
        )}
      >
        {label}
        <Icon className={cn("size-3", !isActive && "opacity-40")} />
      </Link>
    </Th>
  );
}
