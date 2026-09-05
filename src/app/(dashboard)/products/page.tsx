import type { Metadata } from "next";

import { requireAdmin } from "@/lib/auth/guards";
import {
  buildPageMeta,
  one,
  parseListParams,
  type SearchParams,
} from "@/lib/list-params";
import { PRODUCT_STATUSES, type ProductStatus } from "@/lib/enums";
import { PageHeader } from "@/components/shared/page-header";
import { FilterTabs, PaginationBar } from "@/components/shared/list-controls";
import {
  getCategoryTree,
  getProductsTabData,
  getSaleTabData,
} from "@/features/products/queries";
import {
  resolveProductFlag,
  resolveProductSort,
} from "@/features/products/filters";
import { ProductTable } from "@/features/products/components/product-table";
import { ProductToolbar } from "@/features/products/components/product-toolbar";
import { CategoryTab } from "@/features/products/components/category-tab";
import { SaleTab } from "@/features/products/components/sale-tab";

export const metadata: Metadata = { title: "Products" };

/**
 * One page, three tabs. Categories and Sale are small enough that giving each
 * its own route would mean three sidebar entries and two mostly empty screens;
 * as tabs they stay one click from the catalogue they belong to.
 */
type Tab = "products" | "categories" | "sale";

function resolveTab(raw: string | undefined): Tab {
  return raw === "categories" || raw === "sale" ? raw : "products";
}

function resolveStatus(raw: string | undefined): ProductStatus | undefined {
  return (PRODUCT_STATUSES as readonly string[]).includes(raw ?? "")
    ? (raw as ProductStatus)
    : undefined;
}

export default async function ProductsPage({
  searchParams,
}: PageProps<"/products">) {
  await requireAdmin();

  const params = (await searchParams) as SearchParams;
  const tab = resolveTab(one(params, "tab"));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Products"
        description="39 handbags, their colourways, pricing and categories. Saving here changes this database only — the live storefront still reads its own static JS files until src/api/*.js there is repointed at this API."
      >
        <FilterTabs
          paramKey="tab"
          allLabel="Products"
          options={[
            { value: "categories", label: "Categories" },
            { value: "sale", label: "Sale" },
          ]}
        />
      </PageHeader>

      {tab === "categories" ? (
        <CategoriesSection />
      ) : tab === "sale" ? (
        <SaleSection />
      ) : (
        <ProductsSection params={params} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

async function ProductsSection({ params }: { params: SearchParams }) {
  const listParams = parseListParams(params, {
    defaultSort: "updatedAt",
    defaultOrder: "desc",
    pageSize: 25,
  });

  const status = resolveStatus(one(params, "status"));
  const categoryId = one(params, "category");
  const gender = one(params, "gender");
  const flag = resolveProductFlag(one(params, "flag"));

  const data = await getProductsTabData(listParams, {
    status,
    categoryId,
    gender,
    flag,
  });

  const meta = buildPageMeta(data.total, listParams);
  const sort = resolveProductSort(listParams.sort);

  const hasFilters = Boolean(
    listParams.q || status || categoryId || gender || flag,
  );

  return (
    <div className="space-y-3">
      <ProductToolbar
        statusCounts={data.statusCounts}
        categories={data.categories}
        genders={data.genders}
        uncategorisedCount={data.uncategorisedCount}
        activeFlag={flag}
      />

      <div className="surface overflow-hidden">
        <ProductTable
          rows={data.rows}
          params={params}
          sort={sort}
          order={listParams.order}
          hasFilters={hasFilters}
        />
        {data.total > 0 ? (
          <PaginationBar meta={meta} itemLabel="products" />
        ) : null}
      </div>
    </div>
  );
}

async function CategoriesSection() {
  const tree = await getCategoryTree();
  return <CategoryTab tree={tree} />;
}

async function SaleSection() {
  const data = await getSaleTabData();
  return <SaleTab data={data} />;
}
