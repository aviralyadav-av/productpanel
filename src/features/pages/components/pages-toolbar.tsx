"use client";

import { CMS_PAGE_STATUS_META, CMS_PAGE_STATUSES, CMS_PAGE_TEMPLATE_META, CMS_PAGE_TEMPLATES, type CmsPageStatus } from "@/lib/enums";
import { ExportButton } from "@/components/shared/export-button";
import { FilterTabs, SearchInput } from "@/components/shared/list-controls";
import { useQueryNav } from "@/hooks/use-query-nav";

import type { AuthorOption } from "../schemas";
import { ParamSelect } from "./param-select";

/**
 * Filters for /admin/pages, all URL-bound: status tabs with counts, a search
 * box, template / kind / footer / author selects and the export menu, which
 * carries the current filters so "what I see is what I download".
 */
export function PagesToolbar({ statusCounts, authors }: { statusCounts: Record<CmsPageStatus, number>; authors: AuthorOption[] }) {
  const { searchParams } = useQueryNav();
  const exportHref = (format: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    params.set("format", format);
    return `/api/admin/pages/export?${params.toString()}`;
  };

  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <FilterTabs paramKey="status" options={CMS_PAGE_STATUSES.map((status) => ({ value: status, label: CMS_PAGE_STATUS_META[status].label, count: statusCounts[status] }))} />
        <ParamSelect paramKey="template" allLabel="All templates" options={CMS_PAGE_TEMPLATES.map((template) => ({ value: template, label: CMS_PAGE_TEMPLATE_META[template].label }))} className="w-36" />
        <ParamSelect
          paramKey="system"
          allLabel="All kinds"
          options={[
            { value: "1", label: "System pages" },
            { value: "0", label: "Custom pages" },
          ]}
          className="w-32"
        />
        <ParamSelect
          paramKey="footer"
          allLabel="Footer: any"
          options={[
            { value: "1", label: "In footer" },
            { value: "0", label: "Not in footer" },
          ]}
          className="w-32"
        />
        {authors.length > 0 ? <ParamSelect paramKey="authorId" allLabel="All authors" options={authors.map((author) => ({ value: author.id, label: author.name ?? author.email }))} className="w-36" /> : null}
      </div>
      <div className="flex items-center gap-2">
        <SearchInput placeholder="Search title, slug or excerpt…" className="w-full sm:w-64" />
        <ExportButton hrefFor={exportHref} />
      </div>
    </div>
  );
}
