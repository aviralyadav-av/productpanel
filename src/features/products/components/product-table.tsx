import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown, PackageSearch, Star } from "lucide-react";
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
import { ProductThumb } from "@/components/shared/product-thumb";
import { ProductStatusBadge, StockBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { formatIstDate } from "@/lib/dates";
import { formatNumber, formatPaise } from "@/lib/money";
import type { SearchParams } from "@/lib/list-params";
import type { ProductRow } from "@/features/products/queries";
import type { ProductSort } from "@/features/products/filters";
import { GENDER_LABELS, type Gender } from "@/features/products/schemas";

/**
 * A Server Component: sorting is a link, not a click handler, so the whole
 * table stays out of the client bundle and every view is a shareable URL.
 */

/** Sorting a column for the first time should land on its useful direction. */
const DEFAULT_ORDER: Record<ProductSort, "asc" | "desc"> = {
  title: "asc",
  price: "desc",
  stock: "asc",
  updatedAt: "desc",
};

function sortHref(
  params: SearchParams,
  column: ProductSort,
  activeSort: ProductSort,
  activeOrder: "asc" | "desc",
): string {
  const next = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) next.append(key, item);
    } else {
      next.set(key, value);
    }
  }

  next.set("sort", column);
  next.set(
    "order",
    activeSort === column
      ? activeOrder === "asc"
        ? "desc"
        : "asc"
      : DEFAULT_ORDER[column],
  );
  // A re-sort invalidates the page number: row 26 is not the same row any more.
  next.delete("page");

  return `/products?${next.toString()}`;
}

function SortableTh({
  label,
  column,
  params,
  activeSort,
  activeOrder,
  align = "left",
}: {
  label: string;
  column: ProductSort;
  params: SearchParams;
  activeSort: ProductSort;
  activeOrder: "asc" | "desc";
  align?: "left" | "right";
}) {
  const isActive = activeSort === column;
  const Icon = !isActive ? ChevronsUpDown : activeOrder === "asc" ? ArrowUp : ArrowDown;

  return (
    <Th align={align}>
      <Link
        href={sortHref(params, column, activeSort, activeOrder) as never}
        scroll={false}
        aria-label={`Sort by ${label}`}
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

export function ProductTable({
  rows,
  params,
  sort,
  order,
  hasFilters,
}: {
  rows: ProductRow[];
  params: SearchParams;
  sort: ProductSort;
  order: "asc" | "desc";
  hasFilters: boolean;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={PackageSearch}
        title={hasFilters ? "No products match this view" : "No products yet"}
        description={
          hasFilters
            ? "Clear the search or the filters above to see the rest of the catalogue."
            : "The catalogue is empty. Import the storefront data with the seeder, or create the first product by hand."
        }
        action={
          hasFilters ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/products">Clear filters</Link>
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link href="/products/new">New product</Link>
            </Button>
          )
        }
      />
    );
  }

  return (
    <DataTable>
      <DataTableHead>
        <Th width="3rem" />
        <SortableTh
          label="Product"
          column="title"
          params={params}
          activeSort={sort}
          activeOrder={order}
        />
        <Th>Category</Th>
        <Th>For</Th>
        <SortableTh
          label="Price"
          column="price"
          params={params}
          activeSort={sort}
          activeOrder={order}
          align="right"
        />
        <SortableTh
          label="Stock"
          column="stock"
          params={params}
          activeSort={sort}
          activeOrder={order}
          align="right"
        />
        <Th align="right">Variants</Th>
        <Th>Status</Th>
        <Th align="center">Featured</Th>
        <SortableTh
          label="Updated"
          column="updatedAt"
          params={params}
          activeSort={sort}
          activeOrder={order}
          align="right"
        />
      </DataTableHead>

      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.id}>
            <Td>
              <ProductThumb src={row.imageUrl} alt={row.title} size={36} />
            </Td>

            <Td className="max-w-[18rem]">
              <Link
                href={`/products/${row.id}` as never}
                className="block truncate font-medium hover:underline"
              >
                {row.title}
              </Link>
              <p className="text-muted-foreground truncate text-[11px]">
                /{row.slug}
              </p>
            </Td>

            <Td>
              {row.categoryName ?? (
                <span className="text-muted-foreground">Uncategorised</span>
              )}
            </Td>

            <Td className="text-muted-foreground">
              {GENDER_LABELS[row.gender as Gender] ?? row.gender}
            </Td>

            <Td align="right" numeric>
              {row.salePricePaise !== null ? (
                <div className="flex flex-col items-end leading-tight">
                  <span
                    className={cn(
                      "font-medium",
                      row.saleIsBroken && "text-warning",
                    )}
                  >
                    {formatPaise(row.salePricePaise)}
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    <span className="line-through">
                      {formatPaise(row.pricePaise)}
                    </span>
                    {row.saleIsBroken ? (
                      <span className="text-warning ml-1">no discount</span>
                    ) : (
                      <span className="ml-1">−{row.discountPercent}%</span>
                    )}
                  </span>
                </div>
              ) : (
                <span className="font-medium">{formatPaise(row.pricePaise)}</span>
              )}
            </Td>

            <Td align="right" numeric>
              {row.variantCount === 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <div className="flex items-center justify-end gap-2">
                  <span>{formatNumber(row.available)}</span>
                  <StockBadge state={row.stockState} />
                </div>
              )}
            </Td>

            <Td align="right" numeric>
              {row.variantCount === 0 ? (
                <span className="text-warning">none</span>
              ) : (
                row.variantCount
              )}
            </Td>

            <Td>
              <ProductStatusBadge status={row.status} />
            </Td>

            <Td align="center">
              {row.isFeatured ? (
                <Star
                  aria-label="Featured"
                  className="text-brand mx-auto size-3.5 fill-current"
                />
              ) : (
                <span className="text-muted-foreground/40">—</span>
              )}
            </Td>

            <Td align="right" numeric className="text-muted-foreground">
              {formatIstDate(row.updatedAt)}
            </Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );
}
