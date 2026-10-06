import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth/guards";
import { one, type SearchParams } from "@/lib/list-params";
import { PageHeader } from "@/components/shared/page-header";

import { CategoryForm } from "@/features/categories/components/category-form";
import { listCategoryOptions } from "@/features/categories/queries";

export const metadata: Metadata = { title: "New category" };

/** `?parent=<id>` pre-selects the parent (the tree's "Add child" action). */
export default async function NewCategoryPage({ searchParams }: PageProps<"/admin/categories/new">) {
  await requirePermission("categories.manage");
  const params = (await searchParams) as SearchParams;
  const options = await listCategoryOptions();
  const requestedParent = one(params, "parent");
  const defaultParentId = requestedParent && options.some((option) => option.id === requestedParent) ? requestedParent : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="New category"
        description="The slug is derived from the name and suffixed if taken. Attributes, commission and the danger zone become available once the category exists."
      />
      <CategoryForm mode="create" categories={options} defaultParentId={defaultParentId} canManage />
    </div>
  );
}
