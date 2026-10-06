"use client";

import { DateRangePicker } from "@/components/shared/date-range-picker";
import { ExportButton } from "@/components/shared/export-button";

/**
 * Header controls: the shared date-range picker (all eight presets plus a
 * custom span) and the export menu.
 *
 * This is a Client Component only because both children are. The export is a
 * plain GET link rather than an action, so the browser downloads it without
 * JavaScript and the URL - filters included - can be bookmarked or scripted;
 * `query` is the same `from=…&to=…` string the page queried with, so the file
 * always matches the screen it was taken from.
 */
export function DashboardToolbar({ query }: { query: string }) {
  return (
    <>
      <DateRangePicker fallback="30d" align="end" />
      <ExportButton
        formats={["csv", "xlsx", "print"]}
        hrefFor={(format) => `/api/admin/dashboard?${query}&format=${format}`}
        onExport={(format) => {
          // "print" has no file to download: open the server-rendered print
          // view so the operator gets the same rows, laid out for paper.
          if (format === "print") window.open(`/api/admin/dashboard?${query}&format=print`, "_blank");
        }}
      />
    </>
  );
}
