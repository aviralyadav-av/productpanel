import Link from "next/link";
import type { Route } from "next";
import { MessageSquare, Package, ShoppingBag } from "lucide-react";

import { formatIstDate } from "@/lib/dates";
import { formatNumber, formatPaise } from "@/lib/money";
import type { PageMeta } from "@/lib/list-params";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PaginationBar, SearchInput } from "@/components/shared/list-controls";
import { ProductThumb } from "@/components/shared/product-thumb";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { OrderStatusBadge, PaymentStatusBadge, ProductStatusBadge, ReviewStatusBadge } from "@/components/shared/status-badge";

import { RatingText } from "@/features/sellers/components/badges";
import type { SellerOrderGroup, SellerProductRow, SellerReviewRow } from "@/features/sellers/types";

/**
 * Products, Orders and Reviews tabs - read-only lists that link into the
 * owning modules. Server Components; paging and search live in the URL.
 */

export function ProductsTab({ rows, meta }: { rows: SellerProductRow[]; meta: PageMeta }) {
  return (
    <div className="surface overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <SearchInput placeholder="Search this seller's products…" className="w-full sm:w-64" />
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Package} title="No products" description="Products assigned to this seller appear here. Assign one from the product editor." />
      ) : (
        <ResponsiveTable
          table={
            <DataTable>
              <DataTableHead>
                <Th>Product</Th>
                <Th>Category</Th>
                <Th>Status</Th>
                <Th align="right">Price</Th>
                <Th align="right">Variants</Th>
                <Th align="right">Orders</Th>
                <Th align="right">Rating</Th>
                <Th align="right">Updated</Th>
              </DataTableHead>
              <DataTableBody>
                {rows.map((row) => (
                  <Tr key={row.id}>
                    <Td>
                      <Link href={`/admin/products/${row.id}` as Route} className="flex items-center gap-2.5 hover:underline">
                        <ProductThumb src={row.imageUrl} alt={row.title} size={32} />
                        <span className="min-w-0">
                          <span className="block max-w-[18rem] truncate text-sm">{row.title}</span>
                          <span className="text-muted-foreground block truncate font-mono text-[11px]">/{row.slug}</span>
                        </span>
                      </Link>
                    </Td>
                    <Td className="text-xs">{row.categoryName ?? "—"}</Td>
                    <Td>
                      <ProductStatusBadge status={row.status} />
                    </Td>
                    <Td align="right" numeric className="text-xs">
                      {formatPaise(row.effectivePricePaise)}
                    </Td>
                    <Td align="right" numeric className="text-xs">
                      {row.variantCount}
                    </Td>
                    <Td align="right" numeric className="text-xs">
                      {formatNumber(row.orderCount)}
                    </Td>
                    <Td align="right" className="text-xs">
                      <RatingText avg={row.ratingAvg} count={row.reviewCount} />
                    </Td>
                    <Td align="right" numeric className="text-xs">
                      {formatIstDate(new Date(row.updatedAt))}
                    </Td>
                  </Tr>
                ))}
              </DataTableBody>
            </DataTable>
          }
          cards={rows.map((row) => (
            <MobileCard key={row.id} href={`/admin/products/${row.id}`} title={row.title} subtitle={row.categoryName ?? undefined} meta={<ProductStatusBadge status={row.status} />}>
              <MobileCardField label="Price" numeric>
                {formatPaise(row.effectivePricePaise)}
              </MobileCardField>
              <MobileCardField label="Orders" numeric>
                {formatNumber(row.orderCount)}
              </MobileCardField>
            </MobileCard>
          ))}
        />
      )}
      <PaginationBar meta={meta} itemLabel="products" />
    </div>
  );
}

export function OrdersTab({ groups, meta }: { groups: SellerOrderGroup[]; meta: PageMeta }) {
  return (
    <div className="surface overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <SearchInput placeholder="Search by order number…" className="w-full sm:w-64" />
        <p className="text-muted-foreground text-xs">Only this seller&apos;s lines are shown; seller gross is the line before platform-funded discounts (B3).</p>
      </div>
      {groups.length === 0 ? (
        <EmptyState icon={ShoppingBag} title="No orders" description="Orders containing this seller's products appear here." />
      ) : (
        <div className="divide-y">
          {groups.map((group) => (
            <section key={group.orderId} className="px-4 py-3">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/admin/orders/${group.orderId}` as Route} className="font-mono text-sm font-medium hover:underline">
                    {group.orderNumber}
                  </Link>
                  <OrderStatusBadge status={group.status} />
                  <PaymentStatusBadge status={group.paymentStatus} method={group.paymentMethod} />
                  <span className="text-muted-foreground text-xs">{formatIstDate(new Date(group.placedAt))}</span>
                </div>
                <dl className="flex gap-4 text-xs" data-numeric>
                  <div>
                    <dt className="text-muted-foreground inline">Gross </dt>
                    <dd className="inline font-medium">{formatPaise(group.totals.grossPaise)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground inline">Commission </dt>
                    <dd className="inline">{formatPaise(group.totals.commissionPaise)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground inline">Payable </dt>
                    <dd className="text-success inline font-medium">{formatPaise(group.totals.payablePaise)}</dd>
                  </div>
                </dl>
              </header>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-xs">
                  <tbody className="divide-y">
                    {group.items.map((item) => (
                      <tr key={item.id}>
                        <td className="py-1.5 pr-3">
                          <span className="block truncate">{item.title}</span>
                          {item.variant ? <span className="text-muted-foreground block text-[11px]">{item.variant}</span> : null}
                        </td>
                        <td className="py-1.5 pr-3 text-right" data-numeric>
                          × {item.quantity}
                        </td>
                        <td className="py-1.5 pr-3 text-right" data-numeric>
                          {formatPaise(item.sellerGrossPaise)}
                        </td>
                        <td className="text-muted-foreground py-1.5 pr-3 text-right" data-numeric>
                          − {formatPaise(item.commissionPaise)}
                        </td>
                        <td className="py-1.5 text-right font-medium" data-numeric>
                          {formatPaise(item.sellerPayablePaise)}
                        </td>
                        <td className="text-muted-foreground py-1.5 pl-3 text-right text-[11px] uppercase">{item.status.toLowerCase()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
      <PaginationBar meta={meta} itemLabel="orders" />
    </div>
  );
}

export function ReviewsTab({ sellerId, rows, meta }: { sellerId: string; rows: SellerReviewRow[]; meta: PageMeta }) {
  return (
    <div className="surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <p className="text-muted-foreground text-xs">Reviews of this seller&apos;s products. Moderation happens in the reviews module.</p>
        <Button asChild size="sm" variant="outline">
          <Link href={`/admin/reviews?seller=${sellerId}` as Route}>Open in Reviews</Link>
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No reviews" description="Customer reviews of this seller's products will be listed here." />
      ) : (
        <ul className="divide-y">
          {rows.map((row) => (
            <li key={row.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium">{row.authorName}</span>
                  {row.rating ? <RatingText avg={row.rating} count={1} className="[&_span:last-child]:hidden" /> : null}
                  <span className="text-muted-foreground">{formatIstDate(new Date(row.createdAt))}</span>
                  <ReviewStatusBadge status={row.status} />
                </div>
                {row.productId ? (
                  <Link href={`/admin/products/${row.productId}` as Route} className="text-muted-foreground max-w-[18rem] truncate text-xs hover:underline">
                    {row.productTitle}
                  </Link>
                ) : null}
              </div>
              {row.title ? <p className="mt-1 text-sm font-medium">{row.title}</p> : null}
              <p className="text-muted-foreground mt-0.5 line-clamp-3 text-xs leading-relaxed">{row.body}</p>
            </li>
          ))}
        </ul>
      )}
      <PaginationBar meta={meta} itemLabel="reviews" />
    </div>
  );
}
