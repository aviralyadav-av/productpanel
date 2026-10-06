import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ChevronRight, ExternalLink } from "lucide-react";

import { can, requirePermission } from "@/lib/auth/guards";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { FilterTabs } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatusPill } from "@/components/shared/status-badge";

import { CategoryActivityTab } from "@/features/categories/components/category-activity-tab";
import { CategoryAttributesTab } from "@/features/categories/components/category-attributes-tab";
import { CategoryForm } from "@/features/categories/components/category-form";
import { CategoryProductsTab } from "@/features/categories/components/category-products-tab";
import { CommissionSection } from "@/features/categories/components/commission-section";
import { CategoryDangerZone } from "@/features/categories/components/danger-zone";
import { FacetPreview } from "@/features/categories/components/facet-preview";
import {
  getCategoryAttributesTab,
  getCategoryEditor,
  getCategoryFacetPreview,
  listCategoryActivity,
  listCategoryOptions,
  listCategoryProducts,
} from "@/features/categories/queries";
import { resolveCategoryTab, storefrontCategoryPath } from "@/features/categories/schemas";

export const metadata: Metadata = { title: "Category" };

/**
 * /admin/categories/[id]?tab=details|attributes|products|activity
 *
 * Tabs live in the URL so a link to "the attributes of Kurtas" is a link.
 * Only the active tab's data is loaded; the header (breadcrumb, status,
 * storefront path) is shared.
 */
export default async function CategoryEditPage({ params, searchParams }: PageProps<"/admin/categories/[id]">) {
  const actor = await requirePermission("categories.view");
  const { id } = await params;
  const query = (await searchParams) as SearchParams;
  const tab = resolveCategoryTab(typeof query.tab === "string" ? query.tab : undefined);
  const canManage = can(actor, "categories.manage");

  const editor = await getCategoryEditor(id);
  if (!editor) notFound();
  const { category, breadcrumb } = editor;

  return (
    <div className="space-y-4">
      <PageHeader
        title={category.name}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            {breadcrumb.map((crumb, index) => (
              <span key={crumb.id} className="flex items-center gap-1.5">
                {index > 0 ? <ChevronRight className="size-3" /> : null}
                {crumb.id === category.id ? (
                  <span className="text-foreground font-medium">{crumb.name}</span>
                ) : (
                  <Link href={`/admin/categories/${crumb.id}` as Route} className="hover:underline">
                    {crumb.name}
                  </Link>
                )}
              </span>
            ))}
            <span className="text-muted-foreground/60">·</span>
            <span className="inline-flex items-center gap-1 font-mono">
              {storefrontCategoryPath(category.path)} <ExternalLink className="size-3" />
            </span>
          </span>
        }
        actions={
          <>
            {category.isFeatured ? <StatusPill label="Featured" tone="brand" /> : null}
            <StatusPill label={category.isActive ? "Active" : "Disabled"} tone={category.isActive ? "success" : "neutral"} />
          </>
        }
      >
        <FilterTabs
          paramKey="tab"
          allLabel="Details"
          options={[
            { value: "attributes", label: "Attributes" },
            { value: "products", label: "Products", count: editor.usage.subtreeProducts },
            { value: "activity", label: "Activity" },
          ]}
        />
      </PageHeader>

      {tab === "details" ? <DetailsTab editor={editor} canManage={canManage} /> : null}
      {tab === "attributes" ? <AttributesTab id={id} canManage={canManage} /> : null}
      {tab === "products" ? <ProductsTab id={id} query={query} /> : null}
      {tab === "activity" ? <CategoryActivityTab rows={await listCategoryActivity(id)} /> : null}
    </div>
  );
}

async function DetailsTab({
  editor,
  canManage,
}: {
  editor: NonNullable<Awaited<ReturnType<typeof getCategoryEditor>>>;
  canManage: boolean;
}) {
  const options = await listCategoryOptions();
  return (
    <div className="space-y-4">
      <CategoryForm mode="edit" category={editor.category} media={editor.media} categories={options} canManage={canManage} />
      <CommissionSection
        categoryId={editor.category.id}
        own={editor.commission.own}
        effective={editor.commission.effective}
        canManage={canManage}
      />
      {canManage ? <CategoryDangerZone category={editor.category} usage={editor.usage} categories={options} /> : null}
    </div>
  );
}

async function AttributesTab({ id, canManage }: { id: string; canManage: boolean }) {
  const [data, facets] = await Promise.all([getCategoryAttributesTab(id), getCategoryFacetPreview(id)]);
  if (!data || !facets) notFound();
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Panel
        title="Effective attribute set"
        description="Globals, rows inherited from parents and this category's own rows. Toggling an inherited row creates an override here."
        bodyClassName="p-3"
      >
        <CategoryAttributesTab categoryId={id} data={data} canManage={canManage} />
      </Panel>
      <Panel title="Storefront filter preview" description="Exactly what /api/v1/products?category=… returns as facets." className="xl:sticky xl:top-4 xl:self-start">
        <FacetPreview payload={facets} />
      </Panel>
    </div>
  );
}

async function ProductsTab({ id, query }: { id: string; query: SearchParams }) {
  const params = parseListParams({ ...query, q: query.pq }, { defaultSort: "updatedAt", pageSize: 25 });
  const result = await listCategoryProducts(id, params);
  if (!result) notFound();
  return <CategoryProductsTab categoryId={id} rows={result.rows} meta={result.meta} />;
}
