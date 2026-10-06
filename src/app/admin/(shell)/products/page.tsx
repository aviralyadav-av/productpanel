import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { Plus } from "lucide-react";

import { requirePermission } from "@/lib/auth/guards";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";

import { ProductKpiStrip } from "@/features/products/components/product-kpis";
import { ProductList } from "@/features/products/components/product-list";
import { parseProductFilters, resolveProductSort } from "@/features/products/filters";
import {
  getAttributeCatalog,
  getCategoryOptions,
  getProductKpis,
  getSellerRef,
  getStatusCounts,
  listProducts,
} from "@/features/products/queries";

export const metadata: Metadata = { title: "Products" };

/**
 * /admin/products - the catalogue list (blueprint §1 Products, §14.A7).
 * Every filter, the sort and the page live in the URL; this Server Component
 * reads them, queries once, and hands serialisable rows to the client list.
 */
export default async function ProductsPage({ searchParams }: PageProps<"/admin/products">) {
  const actor = await requirePermission("products.view");

  const params = (await searchParams) as SearchParams;
  const listParams = parseListParams(params, { defaultSort: "updatedAt", defaultOrder: "desc", pageSize: 25 });
  const filters = parseProductFilters(params);

  const [result, statusCounts, kpis, categories, attributes, seller] = await Promise.all([
    listProducts(listParams, filters),
    getStatusCounts(filters),
    getProductKpis(),
    getCategoryOptions(),
    getAttributeCatalog(),
    filters.sellerId ? getSellerRef(filters.sellerId) : Promise.resolve(null),
  ]);

  const exportQuery = new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) => (Array.isArray(value) ? value.map((item) => [key, item]) : value ? [[key, value]] : [])),
  );
  exportQuery.delete("page");
  exportQuery.delete("pageSize");

  const permissions = actor.isSuperAdmin ? ["*"] : [...actor.permissions];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Products"
        description="Everything the storefront sells: prices, variants, stock, attributes and customisation. Drafts are invisible until published; archived products keep their order history."
        actions={
          permissions.includes("*") || permissions.includes("products.create") ? (
            <Button asChild size="sm">
              <Link href={"/admin/products/new" as Route}>
                <Plus /> New product
              </Link>
            </Button>
          ) : null
        }
      />

      <ProductKpiStrip kpis={kpis} />

      <ProductList
        rows={result.rows}
        meta={result.meta}
        filters={filters}
        statusCounts={statusCounts}
        sort={resolveProductSort(listParams.sort)}
        order={listParams.order}
        categories={categories}
        attributes={attributes}
        seller={seller}
        permissions={permissions}
        exportQuery={exportQuery.toString()}
      />
    </div>
  );
}
