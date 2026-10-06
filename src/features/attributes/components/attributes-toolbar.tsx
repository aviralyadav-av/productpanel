"use client";

import { useSearchParams } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExportButton } from "@/components/shared/export-button";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { FilterTabs, SearchInput } from "@/components/shared/list-controls";
import { useQueryNav } from "@/hooks/use-query-nav";
import { ATTRIBUTE_INPUT_TYPES, ATTRIBUTE_INPUT_TYPE_META } from "@/lib/enums";

/** Search + three filters, all written to the URL (`q`, `type`, `global`, `active`). */
export function AttributesToolbar({
  counts,
  actions,
}: {
  counts: { all: number; global: number; inactive: number };
  actions?: React.ReactNode;
}) {
  const { navigate, searchParams } = useQueryNav();
  const type = searchParams.get("type") ?? "";
  const global = searchParams.get("global") ?? "";

  return (
    <DataTableToolbar
      search={<SearchInput placeholder="Search name, code or value" className="w-full max-w-xs" />}
      filters={
        <>
          <FilterTabs
            paramKey="active"
            allLabel={`All (${counts.all})`}
            options={[
              { value: "1", label: "Active", count: counts.all - counts.inactive },
              { value: "0", label: "Inactive", count: counts.inactive },
            ]}
          />
          <Select value={type || "__all"} onValueChange={(value) => navigate({ type: value === "__all" ? null : value })}>
            <SelectTrigger size="sm" className="w-40" aria-label="Input type">
              <SelectValue placeholder="Any type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Any type</SelectItem>
              {ATTRIBUTE_INPUT_TYPES.map((inputType) => (
                <SelectItem key={inputType} value={inputType}>
                  {ATTRIBUTE_INPUT_TYPE_META[inputType].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={global || "__all"} onValueChange={(value) => navigate({ global: value === "__all" ? null : value })}>
            <SelectTrigger size="sm" className="w-40" aria-label="Scope">
              <SelectValue placeholder="Any scope" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Any scope</SelectItem>
              <SelectItem value="1">Global ({counts.global})</SelectItem>
              <SelectItem value="0">Category-scoped</SelectItem>
            </SelectContent>
          </Select>
        </>
      }
      actions={actions}
    />
  );
}

/**
 * The export must build its href in the browser.
 *
 * `ExportButton` is a Client Component and `hrefFor` is a function, so a Server
 * Component cannot pass it - React has no way to serialise a closure across the
 * boundary and the page throws "Functions cannot be passed directly to Client
 * Components". Reading the filters from `useSearchParams` here keeps the export
 * and the screen showing the same selection, which is the same pattern the
 * audit log, sellers and newsletter screens use.
 */
export function AttributeExportButton() {
  const searchParams = useSearchParams();

  return (
    <ExportButton
      formats={["csv", "xlsx"]}
      hrefFor={(format) => {
        const params = new URLSearchParams();
        for (const key of ["q", "type", "global", "active"]) {
          const value = searchParams.get(key);
          if (value) params.set(key, value);
        }
        params.set("format", format);
        return `/api/admin/attributes/export?${params.toString()}`;
      }}
    />
  );
}
