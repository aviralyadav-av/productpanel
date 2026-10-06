"use client";

import { useSearchParams } from "next/navigation";

import { DateRangePicker } from "@/components/shared/date-range-picker";
import { ExportButton } from "@/components/shared/export-button";
import { ParamSelect } from "@/features/pages/components/param-select";

import { prefixLabel, type AuditFacets } from "@/features/audit/schemas";

/**
 * Filters for the audit log: who, what module, what kind of thing, and when.
 * All four write to the URL, so a view worth sharing during an incident is a
 * link.
 */
export function AuditFilters({ facets }: { facets: AuditFacets }) {
  return (
    <>
      <ParamSelect
        paramKey="actor"
        allLabel="All actors"
        ariaLabel="Filter by actor"
        className="w-48"
        options={facets.actors.map((actor) => ({
          value: actor.id,
          label: actor.label,
          count: actor.count,
        }))}
      />
      <ParamSelect
        paramKey="action"
        allLabel="All actions"
        ariaLabel="Filter by module"
        options={facets.actionPrefixes.map((prefix) => ({
          value: prefix.value,
          label: prefixLabel(prefix.value),
          count: prefix.count,
        }))}
      />
      <ParamSelect
        paramKey="entity"
        allLabel="All entities"
        ariaLabel="Filter by entity type"
        options={facets.entityTypes.map((entity) => ({
          value: entity.value,
          label: entity.value,
          count: entity.count,
        }))}
      />
      <DateRangePicker />
    </>
  );
}

/**
 * The export is a GET link so the browser downloads it and the URL carries the
 * current filters verbatim - the exported file and the screen can never
 * disagree about what was selected.
 */
export function AuditExportButton() {
  const searchParams = useSearchParams();

  return (
    <ExportButton
      formats={["csv", "xlsx"]}
      hrefFor={(format) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("format", format);
        params.delete("page");
        return `/api/admin/audit-log/export?${params.toString()}`;
      }}
    />
  );
}
