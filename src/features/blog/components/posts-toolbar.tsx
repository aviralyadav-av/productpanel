"use client";

import { BLOG_STATUS_META, BLOG_STATUSES, type BlogStatus } from "@/lib/enums";
import { ExportButton } from "@/components/shared/export-button";
import { FilterTabs, SearchInput } from "@/components/shared/list-controls";
import { useQueryNav } from "@/hooks/use-query-nav";

import { ParamSelect } from "@/features/pages/components/param-select";
import type { AuthorOption } from "@/features/pages/schemas";

import type { BlogCategoryRow } from "../schemas";

/** URL-bound filters for /admin/blog: status tabs (incl. Scheduled), category, tag, featured, author, search, export. */
export function PostsToolbar({
  statusCounts,
  categories,
  tags,
  authors,
}: {
  statusCounts: Record<BlogStatus, number>;
  categories: BlogCategoryRow[];
  tags: Array<{ tag: string; count: number }>;
  authors: AuthorOption[];
}) {
  const { searchParams } = useQueryNav();
  const exportHref = (format: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    params.set("format", format);
    return `/api/admin/blog/export?${params.toString()}`;
  };

  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <FilterTabs paramKey="status" options={BLOG_STATUSES.map((status) => ({ value: status, label: BLOG_STATUS_META[status].label, count: statusCounts[status] }))} />
        <ParamSelect paramKey="categoryId" allLabel="All categories" options={[{ value: "none", label: "Uncategorised" }, ...categories.map((category) => ({ value: category.id, label: category.name, count: category.postCount }))]} className="w-40" />
        {tags.length > 0 ? <ParamSelect paramKey="tag" allLabel="All tags" options={tags.slice(0, 60).map((entry) => ({ value: entry.tag, label: entry.tag, count: entry.count }))} className="w-36" /> : null}
        <ParamSelect
          paramKey="featured"
          allLabel="Featured: any"
          options={[
            { value: "1", label: "Featured only" },
            { value: "0", label: "Not featured" },
          ]}
          className="w-36"
        />
        {authors.length > 0 ? <ParamSelect paramKey="authorId" allLabel="All authors" options={authors.map((author) => ({ value: author.id, label: author.name ?? author.email }))} className="w-36" /> : null}
      </div>
      <div className="flex items-center gap-2">
        <SearchInput placeholder="Search title, slug, tag or author…" className="w-full sm:w-64" />
        <ExportButton hrefFor={exportHref} />
      </div>
    </div>
  );
}
