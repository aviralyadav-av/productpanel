"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

import { DateRangePicker } from "@/components/shared/date-range-picker";
import { ExportButton } from "@/components/shared/export-button";
import { useQueryNav } from "@/hooks/use-query-nav";

/** Secondary filters for /admin/newsletter; native selects that write to the URL. */
const selectClass =
  "border-input bg-background h-8 rounded-md border px-2 text-xs shadow-xs focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none";

export function NewsletterFilters({ sources }: { sources: string[] }) {
  const { navigate, searchParams } = useQueryNav();
  const source = searchParams.get("source") ?? "";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Filter by source" className={selectClass} value={source} onChange={(event) => navigate({ source: event.target.value || null })}>
        <option value="">Any source</option>
        {sources.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
        <option value="none">No source</option>
      </select>
      <DateRangePicker fallback="this_year" />
    </div>
  );
}

/**
 * Streams the CURRENT filters to /api/admin/newsletter/export so the file
 * matches the screen. The endpoint checks `newsletter.export` and audits the
 * download with the filter and row count (D13).
 */
export function NewsletterExportButton() {
  const searchParams = useSearchParams();
  return (
    <ExportButton
      formats={["csv", "xlsx"]}
      hrefFor={(format) => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("page");
        params.delete("pageSize");
        params.set("format", format);
        return `/api/admin/newsletter/export?${params.toString()}`;
      }}
    />
  );
}
