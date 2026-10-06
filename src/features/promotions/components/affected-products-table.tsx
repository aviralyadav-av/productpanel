import Link from "next/link";
import type { Route } from "next";
import { PackageSearch } from "lucide-react";

import { PRODUCT_STATUS_META, type ProductStatus } from "@/lib/enums";
import type { PageMeta } from "@/lib/list-params";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PaginationBar, SearchInput } from "@/components/shared/list-controls";
import { PriceText } from "@/components/shared/price-text";
import { ProductThumb } from "@/components/shared/product-thumb";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { StatusPill } from "@/components/shared/status-badge";

import type { AffectedProductRow } from "../schemas";

/**
 * Products in the promotion's scope. "Applied" means this promotion is the one
 * writing `promotionPricePaise` on the product (A4); a product can be in scope
 * yet show another promotion or its own sale price when that is cheaper.
 */
export function AffectedProductsTable({ rows, meta }: { rows: AffectedProductRow[]; meta: PageMeta }) {
  const productHref = (id: string) => `/admin/products/${id}` as Route;

  const appliedPill = (row: AffectedProductRow) =>
    row.applied ? (
      <StatusPill label="Applied" tone="success" />
    ) : row.outrankedBy ? (
      <StatusPill label={`Outranked by ${row.outrankedBy}`} tone="warning" />
    ) : (
      <StatusPill label="Sale price is lower" tone="neutral" />
    );

  const table = (
    <DataTable>
      <DataTableHead>
        <Th>Product</Th>
        <Th>Seller</Th>
        <Th>Status</Th>
        <Th align="right">List price</Th>
        <Th align="right">Promotion price</Th>
        <Th align="right">Effective</Th>
        <Th>Applied</Th>
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => {
          const status = PRODUCT_STATUS_META[row.status as ProductStatus];
          return (
            <Tr key={row.id}>
              <Td>
                <div className="flex items-center gap-2">
                  <ProductThumb src={row.imageUrl} alt="" size={32} />
                  <Link href={productHref(row.id)} className="line-clamp-1 hover:underline">
                    {row.title}
                  </Link>
                </div>
              </Td>
              <Td>{row.sellerName ?? <span className="text-muted-foreground">Platform</span>}</Td>
              <Td>{status ? <StatusPill label={status.label} tone={status.tone} /> : row.status}</Td>
              <Td align="right" numeric>
                <PriceText paise={row.pricePaise} />
              </Td>
              <Td align="right" numeric>
                {row.promotionPricePaise !== null ? <PriceText paise={row.promotionPricePaise} /> : <span className="text-muted-foreground">—</span>}
              </Td>
              <Td align="right" numeric>
                <PriceText paise={row.effectivePricePaise} />
              </Td>
              <Td>{appliedPill(row)}</Td>
            </Tr>
          );
        })}
      </DataTableBody>
    </DataTable>
  );

  const cards = (
    <div className="space-y-2">
      {rows.map((row) => (
        <MobileCard key={row.id} title={row.title} subtitle={row.sellerName ?? "Platform"} meta={appliedPill(row)} href={productHref(row.id)}>
          <MobileCardField label="List" numeric>
            <PriceText paise={row.pricePaise} />
          </MobileCardField>
          <MobileCardField label="Effective" numeric>
            <PriceText paise={row.effectivePricePaise} />
          </MobileCardField>
        </MobileCard>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      <SearchInput placeholder="Search products in scope…" className="w-full sm:w-72" />
      {rows.length === 0 ? (
        <div className="surface">
          <EmptyState icon={PackageSearch} title="No products in scope" description="Widen the scope or check that the chosen categories, sellers or products still exist." compact />
        </div>
      ) : (
        <>
          <div className="surface overflow-hidden">
            <ResponsiveTable table={table} cards={cards} />
          </div>
          <PaginationBar meta={meta} itemLabel="products" />
        </>
      )}
    </div>
  );
}
