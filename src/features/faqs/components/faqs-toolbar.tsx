"use client";

import { ExportButton } from "@/components/shared/export-button";
import { FilterTabs, SearchInput } from "@/components/shared/list-controls";
import { useQueryNav } from "@/hooks/use-query-nav";
import { ParamSelect } from "@/features/pages/components/param-select";

import type { FaqGroupSummary } from "../schemas";

/**
 * Filters for /admin/faqs, all URL-bound (§8): group tabs with counts, a
 * visibility/featured select, search across question, answer and group, and
 * the export menu - which carries the current filters so the CSV matches what
 * is on screen.
 *
 * Group tabs only appear once there is more than one group: with a single
 * group they would be a row of noise above a board that already says the name.
 */
export function FaqsToolbar({ groups }: { groups: FaqGroupSummary[] }) {
  const { searchParams } = useQueryNav();
  const exportHref = (format: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("format", format);
    return `/api/admin/faqs/export?${params.toString()}`;
  };

  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        {groups.length > 1 ? <FilterTabs paramKey="group" allLabel="All groups" options={groups.map((group) => ({ value: group.group, label: group.group, count: group.count }))} /> : null}
        <ParamSelect
          paramKey="enabled"
          allLabel="Any visibility"
          options={[
            { value: "1", label: "Shown" },
            { value: "0", label: "Hidden" },
          ]}
          className="w-36"
        />
        <ParamSelect
          paramKey="featured"
          allLabel="Featured: any"
          options={[
            { value: "1", label: "Featured" },
            { value: "0", label: "Not featured" },
          ]}
          className="w-36"
        />
      </div>
      <div className="flex items-center gap-2">
        <SearchInput placeholder="Search questions and answers…" className="w-full sm:w-64" />
        <ExportButton hrefFor={exportHref} />
      </div>
    </div>
  );
}
