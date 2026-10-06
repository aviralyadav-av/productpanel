import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { ArrowLeft } from "lucide-react";

import { can, requirePermission } from "@/lib/auth/guards";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";

import { CategoriesManager } from "@/features/blog/components/categories-manager";
import { listBlogCategories } from "@/features/blog/queries";

export const metadata: Metadata = { title: "Blog categories" };

/** /admin/blog/categories - BlogCategory CRUD with drag reorder and post counts. */
export default async function BlogCategoriesPage() {
  const actor = await requirePermission("blog.view");
  const rows = await listBlogCategories();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Blog categories"
        description="Categories group posts on the storefront blog index and power its category filter. Deleting one keeps its posts, uncategorised."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={"/admin/blog" as Route}>
              <ArrowLeft /> Posts
            </Link>
          </Button>
        }
      />
      <CategoriesManager rows={rows} canManage={can(actor, "blog.manage")} />
    </div>
  );
}
