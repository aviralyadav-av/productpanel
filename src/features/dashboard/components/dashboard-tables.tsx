import Link from "next/link";
import { Boxes, PackageSearch, ShoppingCart, Users } from "lucide-react";

import {
  getRecentCustomers,
  getRecentOrders,
  getStockSnapshot,
  getTopProducts,
} from "@/features/dashboard/queries";
import { EmptyState } from "@/components/shared/empty-state";
import { OrderStatusBadge, StockBadge } from "@/components/shared/status-badge";
import { ProductThumb } from "@/components/shared/product-thumb";
import { formatIstDate } from "@/lib/dates";
import { formatNumber, formatPaise } from "@/lib/money";
import type { RangePreset } from "@/lib/dates";

export async function RecentOrdersTable() {
  const orders = await getRecentOrders(7);

  if (orders.length === 0) {
    return (
      <EmptyState
        compact
        icon={ShoppingCart}
        title="No orders yet"
        description="The storefront currently saves orders to the shopper's own browser and never sends them to a server, so nothing arrives here until the checkout is pointed at this API."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground border-b">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Order</th>
            <th className="px-3 py-2 text-left font-medium">Customer</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">Total</th>
            <th className="px-4 py-2 text-right font-medium">Placed</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {orders.map((order) => (
            <tr key={order.id} className="hover:bg-accent/40 transition-colors">
              <td className="px-4 py-2">
                <Link
                  href={`/orders/${order.id}` as never}
                  className="font-medium hover:underline"
                >
                  {order.orderNumber}
                </Link>
                <p className="text-muted-foreground text-[11px]">
                  {order._count.items} item
                  {order._count.items === 1 ? "" : "s"} · {order.paymentMethod}
                </p>
              </td>
              <td className="max-w-[10rem] px-3 py-2">
                <p className="truncate">{order.shipFullName}</p>
                <p className="text-muted-foreground truncate text-[11px]">
                  {order.shipCity}
                </p>
              </td>
              <td className="px-3 py-2">
                <OrderStatusBadge status={order.status} />
              </td>
              <td data-numeric className="px-3 py-2 text-right font-medium">
                {formatPaise(order.totalPaise)}
              </td>
              <td
                data-numeric
                className="text-muted-foreground px-4 py-2 text-right"
              >
                {formatIstDate(order.placedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function TopProductsTable({ preset }: { preset: RangePreset }) {
  const products = await getTopProducts(preset, 5);

  if (products.length === 0) {
    return (
      <EmptyState
        compact
        icon={PackageSearch}
        title="No sales in this period"
        description="Top sellers are ranked by revenue from real order lines, so this fills in as orders arrive."
      />
    );
  }

  const max = Math.max(...products.map((product) => product.revenuePaise), 1);

  return (
    <ul className="divide-y">
      {products.map((product, index) => (
        <li key={product.id} className="flex items-center gap-3 px-4 py-2.5">
          <span
            data-numeric
            className="text-muted-foreground w-3 shrink-0 text-xs"
          >
            {index + 1}
          </span>

          <ProductThumb src={product.imageUrl} alt={product.title} size={32} />

          <div className="min-w-0 flex-1">
            <Link
              href={`/products/${product.id}` as never}
              className="block truncate text-xs font-medium hover:underline"
            >
              {product.title}
            </Link>
            <div className="mt-1 flex items-center gap-2">
              <div className="bg-muted h-1 w-full max-w-24 overflow-hidden rounded-full">
                <div
                  className="bg-chart-1 h-full rounded-full"
                  style={{ width: `${(product.revenuePaise / max) * 100}%` }}
                />
              </div>
              <span className="text-muted-foreground text-[11px]" data-numeric>
                {formatNumber(product.units)} sold
              </span>
            </div>
          </div>

          <span data-numeric className="shrink-0 text-xs font-medium">
            {formatPaise(product.revenuePaise)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export async function StockPanel() {
  const stock = await getStockSnapshot();
  const rows = [...stock.outOfStock, ...stock.lowStock].slice(0, 6);

  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        icon={Boxes}
        title="Every variant is stocked"
        description={`All ${stock.total} variants are above their low-stock threshold.`}
      />
    );
  }

  return (
    <ul className="divide-y">
      {rows.map((row) => (
        <li
          key={row.variantId}
          className="flex items-center gap-3 px-4 py-2.5"
        >
          <div className="min-w-0 flex-1">
            <Link
              href={`/products/${row.productId}` as never}
              className="block truncate text-xs font-medium hover:underline"
            >
              {row.title}
            </Link>
            <p className="text-muted-foreground truncate text-[11px]">
              {row.variantName} · {row.sku}
            </p>
          </div>

          <span data-numeric className="text-xs font-medium">
            {row.available}
          </span>
          <StockBadge state={row.state} />
        </li>
      ))}
    </ul>
  );
}

export async function RecentCustomersTable() {
  const customers = await getRecentCustomers(5);

  if (customers.length === 0) {
    return (
      <EmptyState
        compact
        icon={Users}
        title="No customers yet"
        description="Customer records are created from orders. The storefront's own accounts live in each shopper's localStorage and cannot be imported."
      />
    );
  }

  return (
    <ul className="divide-y">
      {customers.map((customer) => (
        <li key={customer.id} className="flex items-center gap-3 px-4 py-2.5">
          <div className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium">
            {customer.name.slice(0, 2).toUpperCase()}
          </div>

          <div className="min-w-0 flex-1">
            <Link
              href={`/customers?customer=${customer.id}` as never}
              className="block truncate text-xs font-medium hover:underline"
            >
              {customer.name}
            </Link>
            <p className="text-muted-foreground truncate text-[11px]">
              {customer.email}
            </p>
          </div>

          <div className="shrink-0 text-right">
            <p data-numeric className="text-xs font-medium">
              {formatPaise(customer.lifetimeValuePaise)}
            </p>
            <p className="text-muted-foreground text-[11px]" data-numeric>
              {customer.orderCount} order
              {customer.orderCount === 1 ? "" : "s"}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
