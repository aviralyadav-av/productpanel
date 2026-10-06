import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { FolderOpen, Plus } from "lucide-react";

import { can, requirePermission } from "@/lib/auth/guards";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";

import { PostsTable } from "@/features/blog/components/posts-table";
import { PostsToolbar } from "@/features/blog/components/posts-toolbar";
import { listBlogAuthors, listBlogCategories, listBlogPosts, listBlogTags } from "@/features/blog/queries";
import { parseBlogListFilters, resolveBlogSort } from "@/features/blog/schemas";

export const metadata: Metadata = { title: "Blog" };

/**
 * /admin/blog (blueprint §1 Blog): posts with status tabs (Draft, Published,
 * Scheduled, Archived), category / tag / featured / author filters, search,
 * sortable columns and row actions. All list state is in the URL.
 */
export default async function BlogPage({ searchParams }: PageProps<"/admin/blog">) {
  const actor = await requirePermission("blog.view");

  const raw = (await searchParams) as SearchParams;
  const params = parseListParams(raw, { defaultSort: "updatedAt", defaultOrder: "desc" });
  const sort = resolveBlogSort(params.sort);
  const filters = parseBlogListFilters(raw);
  const canManage = can(actor, "blog.manage");
  const canPublish = can(actor, "blog.publish");

  const [result, categories, tags, authors] = await Promise.all([listBlogPosts({ ...params, sort }, filters), listBlogCategories(), listBlogTags(), listBlogAuthors()]);
  const filtered = Boolean(filters.q || filters.status || filters.categoryId || filters.tag || filters.featured !== undefined || filters.authorId);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Blog"
        description="Posts, drafts and schedules. A scheduled post goes live on the storefront at its date with no further action; reading time is computed from the body."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={"/admin/blog/categories" as Route}>
                <FolderOpen /> Categories
              </Link>
            </Button>
            {canManage ? (
              <Button asChild size="sm">
                <Link href={"/admin/blog/new" as Route}>
                  <Plus /> New post
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <PostsToolbar statusCounts={result.statusCounts} categories={categories} tags={tags} authors={authors} />

      <div className="surface overflow-hidden">
        <PostsTable rows={result.rows} meta={result.meta} params={{ ...params, sort }} canManage={canManage} canPublish={canPublish} filtered={filtered} />
      </div>
    </div>
  );
}
