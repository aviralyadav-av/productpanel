"use client";

import Link from "next/link";
import type { Route } from "next";
import { X } from "lucide-react";

import { inventoryHref } from "@/features/inventory/format";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { ExportButton } from "@/components/shared/export-button";
import { FilterTabs, SearchInput } from "@/components/shared/list-controls";
import { useQueryNav } from "@/hooks/use-query-nav";
import { STOCK_MOVEMENT_META, type StockMovementType } from "@/lib/enums";

/**
 * Type tabs (only types that actually occur in scope), search across
 * SKU / product / order number, a date range and export. Without a range in
 * the URL the ledger shows all time; the picker narrows from there.
 */
export function MovementsToolbar({
  typeCounts,
  variantScope,
}: {
  typeCounts: Array<{ type: StockMovementType; count: number }>;
  variantScope: string | null;
}) {
  const { searchParams } = useQueryNav();

  const exportHref = (format: "csv" | "xlsx") => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    params.delete("tab");
    params.set("format", format);
    params.set("scope", "movements");
    return `/api/admin/inventory/export?${params.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput placeholder="Search SKU, product or order…" className="w-full sm:w-64" />
      {typeCounts.length > 0 ? (
        <FilterTabs
          paramKey="type"
          allLabel="All types"
          options={typeCounts.map((row) => ({
            value: row.type,
            label: STOCK_MOVEMENT_META[row.type].label,
            count: row.count,
          }))}
        />
      ) : null}
      <DateRangePicker fallback="30d" />
      {variantScope ? (
        <Link
          href={inventoryHref({ tab: "movements" }) as Route}
          scroll={false}
          className="bg-brand-muted text-brand hover:bg-brand-muted/70 inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors"
        >
          {variantScope}
          <X className="size-3" />
          <span className="sr-only">Clear the variant filter</span>
        </Link>
      ) : null}
      <div className="ml-auto">
        <ExportButton hrefFor={exportHref} />
      </div>
    </div>
  );
}
