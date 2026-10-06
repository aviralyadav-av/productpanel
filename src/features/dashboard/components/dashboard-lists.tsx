import Link from "next/link";
import type { Route } from "next";
import {
  Boxes,
  ClipboardList,
  MessageSquare,
  ShoppingCart,
  Store,
  UserPlus,
} from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import {
  DataTable,
  DataTableBody,
  DataTableHead,
  Td,
  Th,
  Tr,
} from "@/components/shared/data-table";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import {
  OrderStatusBadge,
  PaymentStatusBadge,
  ReviewStatusBadge,
  StatusPill,
} from "@/components/shared/status-badge";
import { RatingStars } from "@/features/reviews/components/rating-stars";
import { SELLER_STATUS_META, type SellerStatus } from "@/lib/enums";
import { formatIstDate, formatIstDateTime } from "@/lib/dates";
import { formatNumber, formatPaise } from "@/lib/money";

import type {
  ActivityRow,
  RecentCustomerRow,
  RecentOrderRow,
  RecentReviewRow,
  RecentSellerRow,
  TopProductRow,
  TopSellerRow,
} from "../types";

/**
 * The dashboard's list panels: pure presentation over rows the panel already
 * fetched, so each one can live inside its own Suspense island.
 *
 * Every table follows the house rule that a dense grid is the right tool on a
 * desk and the wrong one on a phone: ResponsiveTable renders the table from
 * `md` up and a stack of MobileCards below it, both on the server, so there
 * is no viewport sniffing and no hydration flash.
 *
 * Empty states say what WOULD be here rather than "no data", because on a
 * fresh install an empty panel is indistinguishable from a broken one.
 */

// ---------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------

export function TopProductsPanel({ rows }: { rows: readonly TopProductRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        icon={Boxes}
        title="No units sold in this period"
        description="Widen the date range, or check that orders are reaching the API."
      />
    );
  }

  return (
    <ResponsiveTable
      table={
        <DataTable>
          <DataTableHead>
            <Th>Product</Th>
            <Th align="right">Units</Th>
            <Th align="right">Revenue</Th>
          </DataTableHead>
          <DataTableBody>
            {rows.map((row) => (
              <Tr key={row.productId ?? row.title}>
                <Td>
                  <ProductLink productId={row.productId} title={row.title} />
                  {row.sellerName ? (
                    <p className="text-muted-foreground truncate text-[11px]">{row.sellerName}</p>
                  ) : null}
                </Td>
                <Td align="right" numeric>
                  {formatNumber(row.units)}
                </Td>
                <Td align="right" numeric className="font-medium">
                  {formatPaise(row.revenuePaise)}
                </Td>
              </Tr>
            ))}
          </DataTableBody>
        </DataTable>
      }
      cards={rows.map((row) => (
        <MobileCard
          key={row.productId ?? row.title}
          title={row.title}
          subtitle={row.sellerName ?? undefined}
          meta={
            <span data-numeric className="text-xs font-medium">
              {formatPaise(row.revenuePaise)}
            </span>
          }
        >
          <MobileCardField label="Units" numeric>
            {formatNumber(row.units)}
          </MobileCardField>
        </MobileCard>
      ))}
    />
  );
}

export function TopSellersPanel({ rows }: { rows: readonly TopSellerRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        icon={Store}
        title="No seller sales in this period"
        description="Order lines with no seller are grouped under Platform."
      />
    );
  }

  return (
    <ResponsiveTable
      table={
        <DataTable>
          <DataTableHead>
            <Th>Seller</Th>
            <Th align="right">Orders</Th>
            <Th align="right">Gross</Th>
            <Th align="right">Payable</Th>
          </DataTableHead>
          <DataTableBody>
            {rows.map((row) => (
              <Tr key={row.sellerId ?? row.name}>
                <Td>
                  {row.sellerId ? (
                    <Link
                      href={`/admin/sellers/${row.sellerId}` as Route}
                      className="font-medium hover:underline"
                    >
                      {row.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{row.name}</span>
                  )}
                </Td>
                <Td align="right" numeric>
                  {formatNumber(row.orders)}
                </Td>
                <Td align="right" numeric>
                  {formatPaise(row.grossPaise)}
                </Td>
                <Td align="right" numeric className="font-medium">
                  {formatPaise(row.payablePaise)}
                </Td>
              </Tr>
            ))}
          </DataTableBody>
        </DataTable>
      }
      cards={rows.map((row) => (
        <MobileCard
          key={row.sellerId ?? row.name}
          title={row.name}
          meta={
            <span data-numeric className="text-xs font-medium">
              {formatPaise(row.payablePaise)}
            </span>
          }
        >
          <MobileCardField label="Orders" numeric>
            {formatNumber(row.orders)}
          </MobileCardField>
          <MobileCardField label="Gross" numeric>
            {formatPaise(row.grossPaise)}
          </MobileCardField>
        </MobileCard>
      ))}
    />
  );
}

// ---------------------------------------------------------------------------
// Recent activity strips
// ---------------------------------------------------------------------------

export function RecentOrdersPanel({ rows }: { rows: readonly RecentOrderRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        icon={ShoppingCart}
        title="No orders yet"
        description="Orders placed on the storefront or keyed in manually appear here as they arrive."
      />
    );
  }

  return (
    <ResponsiveTable
      table={
        <DataTable>
          <DataTableHead>
            <Th>Order</Th>
            <Th>Customer</Th>
            <Th>Status</Th>
            <Th>Payment</Th>
            <Th align="right">Total</Th>
          </DataTableHead>
          <DataTableBody>
            {rows.map((row) => (
              <Tr key={row.id}>
                <Td>
                  <Link href={`/admin/orders/${row.id}` as Route} className="font-medium hover:underline">
                    {row.orderNumber}
                  </Link>
                  <p className="text-muted-foreground text-[11px]">{formatIstDate(row.placedAt)}</p>
                </Td>
                <Td className="max-w-[12rem] truncate">{row.customerName}</Td>
                <Td>
                  <OrderStatusBadge status={row.status} />
                </Td>
                <Td>
                  <PaymentStatusBadge status={row.paymentStatus} method={row.paymentMethod} />
                </Td>
                <Td align="right" numeric className="font-medium">
                  {formatPaise(row.totalPaise)}
                </Td>
              </Tr>
            ))}
          </DataTableBody>
        </DataTable>
      }
      cards={rows.map((row) => (
        <MobileCard
          key={row.id}
          href={`/admin/orders/${row.id}`}
          title={row.orderNumber}
          subtitle={row.customerName}
          meta={<OrderStatusBadge status={row.status} />}
        >
          <MobileCardField label="Total" numeric>
            {formatPaise(row.totalPaise)}
          </MobileCardField>
          <MobileCardField label="Placed">{formatIstDate(row.placedAt)}</MobileCardField>
        </MobileCard>
      ))}
    />
  );
}

export function RecentCustomersPanel({ rows }: { rows: readonly RecentCustomerRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        icon={UserPlus}
        title="No customers yet"
        description="Accounts created on the website sync here through the integration API."
      />
    );
  }

  return (
    <ul className="divide-y">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={`/admin/customers/${row.id}` as Route}
            className="hover:bg-accent/40 flex items-center gap-3 px-4 py-2.5 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{row.name}</p>
              <p className="text-muted-foreground truncate text-[11px]">{row.email}</p>
            </div>
            <div className="shrink-0 text-right">
              <p data-numeric className="text-xs font-medium">
                {formatPaise(row.totalSpentPaise)}
              </p>
              <p className="text-muted-foreground text-[11px]">
                {formatNumber(row.orderCount)} order{row.orderCount === 1 ? "" : "s"} ·{" "}
                {formatIstDate(row.createdAt)}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function RecentSellersPanel({ rows }: { rows: readonly RecentSellerRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        icon={Store}
        title="No seller registrations"
        description="Applications from the public seller registration API land here for approval."
      />
    );
  }

  return (
    <ul className="divide-y">
      {rows.map((row) => {
        const meta = SELLER_STATUS_META[row.status as SellerStatus];
        return (
          <li key={row.id}>
            <Link
              href={`/admin/sellers/${row.id}` as Route}
              className="hover:bg-accent/40 flex items-center gap-3 px-4 py-2.5 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{row.name}</p>
                <p className="text-muted-foreground truncate text-[11px]">
                  {row.email} · {formatNumber(row.productCount)} product
                  {row.productCount === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusPill label={meta?.label ?? row.status} tone={meta?.tone ?? "neutral"} />
                <span className="text-muted-foreground text-[11px]">{formatIstDate(row.createdAt)}</span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function RecentReviewsPanel({ rows }: { rows: readonly RecentReviewRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        icon={MessageSquare}
        title="No reviews yet"
        description="Customer reviews arrive PENDING and stay hidden until approved."
      />
    );
  }

  return (
    <ul className="divide-y">
      {rows.map((row) => (
        <li key={row.id}>
          {/* Deep-links to the review's own moderation sheet, not just the list. */}
          <Link
            href={`/admin/reviews?review=${row.id}` as Route}
            className="hover:bg-accent/40 flex items-center gap-3 px-4 py-2.5 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{row.productTitle ?? "Testimonial"}</p>
              <p className="text-muted-foreground truncate text-[11px]">
                {row.authorName} · {formatIstDate(row.createdAt)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <RatingStars rating={row.rating} />
              <ReviewStatusBadge status={row.status} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ActivityPanel({ rows }: { rows: readonly ActivityRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        icon={ClipboardList}
        title="Nothing recorded yet"
        description="Every change an admin makes is written to the audit log and appears here."
      />
    );
  }

  return (
    <ul className="divide-y">
      {rows.map((row) => {
        const body = (
          <>
            <p className="text-xs leading-snug">{row.summary}</p>
            <p className="text-muted-foreground mt-0.5 text-[11px]">
              {row.actorEmail} · {formatIstDateTime(row.createdAt)}
            </p>
          </>
        );
        return (
          <li key={row.id}>
            {row.href ? (
              <Link
                href={row.href as Route}
                className="hover:bg-accent/40 block px-4 py-2.5 transition-colors"
              >
                {body}
              </Link>
            ) : (
              <div className="px-4 py-2.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A product deleted since the order was placed keeps its snapshot title. */
function ProductLink({ productId, title }: { productId: string | null; title: string }) {
  if (!productId) return <span className="font-medium">{title}</span>;
  return (
    <Link href={`/admin/products/${productId}` as Route} className="font-medium hover:underline">
      {title}
    </Link>
  );
}
