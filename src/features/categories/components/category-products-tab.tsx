import Link from "next/link";
import type { Route } from "next";
import { Package } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PaginationBar, SearchInput } from "@/components/shared/list-controls";
import { PriceText } from "@/components/shared/price-text";
import { ProductThumb } from "@/components/shared/product-thumb";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { ProductStatusBadge, StatusPill } from "@/components/shared/status-badge";
import type { PageMeta } from "@/lib/list-params";
import { formatIstDate } from "@/lib/dates";

import type { CategoryProductRow } from "../queries";

/**
 * Products tab: direct AND descendant products (A9 semantics), each linking
 * to its editor. The "Sub-category" pill marks rows that live below this
 * category so an operator sees at a glance where the volume actually sits.
 */
export function CategoryProductsTab({
  categoryId,
  rows,
  meta,
}: {
  categoryId: string;
  rows: CategoryProductRow[];
  meta: PageMeta;
}) {
  const allHref = `/admin/products?category=${encodeURIComponent(categoryId)}&includeDescendants=1` as Route;

  return (
    <div className="surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <SearchInput paramKey="pq" placeholder="Search products in this category" className="w-full max-w-xs" />
        <Button asChild variant="outline" size="sm">
          <Link href={allHref}>Open in product list</Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          compact
          icon={Package}
          title={meta.total === 0 ? "No products in this subtree" : "No products match"}
          description={meta.total === 0 ? "Products assigned to this category or any sub-category appear here." : "Try a different search."}
        />
      ) : (
        <ResponsiveTable
          table={
            <DataTable>
              <DataTableHead>
                <Th>Product</Th>
                <Th>Category</Th>
                <Th>Seller</Th>
                <Th>Status</Th>
                <Th align="right">Price</Th>
                <Th align="right">Updated</Th>
              </DataTableHead>
              <DataTableBody>
                {rows.map((row) => (
                  <Tr key={row.id}>
                    <Td>
                      <Link href={`/admin/products/${row.id}` as Route} className="flex items-center gap-2 hover:underline">
                        <ProductThumb src={row.imageUrl} alt="" size={28} />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{row.title}</span>
                          <span className="text-muted-foreground truncate font-mono text-[11px]">{row.slug}</span>
                        </span>
                      </Link>
                    </Td>
                    <Td>
                      <span className="flex items-center gap-1.5">
                        {row.categoryId ? (
                          <Link href={`/admin/categories/${row.categoryId}` as Route} className="hover:underline">
                            {row.categoryName}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                        {row.fromDescendant ? <StatusPill label="Sub-category" tone="info" dot={false} /> : null}
                      </span>
                    </Td>
                    <Td>{row.sellerName ?? <span className="text-muted-foreground">Platform</span>}</Td>
                    <Td>
                      <ProductStatusBadge status={row.status} />
                    </Td>
                    <Td align="right" numeric>
                      <PriceText paise={row.effectivePricePaise} comparePaise={row.effectivePricePaise < row.pricePaise ? row.pricePaise : undefined} />
                    </Td>
                    <Td align="right" numeric>
                      {formatIstDate(new Date(row.updatedAt))}
                    </Td>
                  </Tr>
                ))}
              </DataTableBody>
            </DataTable>
          }
          cards={rows.map((row) => (
            <MobileCard key={row.id} title={row.title} subtitle={row.categoryName ?? undefined} href={`/admin/products/${row.id}`} meta={<ProductStatusBadge status={row.status} />}>
              <MobileCardField label="Price" numeric>
                <PriceText paise={row.effectivePricePaise} />
              </MobileCardField>
              <MobileCardField label="Seller">{row.sellerName ?? "Platform"}</MobileCardField>
            </MobileCard>
          ))}
        />
      )}
      <PaginationBar meta={meta} itemLabel="products" />
    </div>
  );
}
