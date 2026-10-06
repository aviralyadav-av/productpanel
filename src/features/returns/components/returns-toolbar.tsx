"use client";

import { useSearchParams } from "next/navigation";
import { X } from "lucide-react";

import {
  OPEN_RETURN_STATUSES,
  RETURN_REASONS,
  RETURN_REASON_META,
  RETURN_REQUEST_STATUSES,
  RETURN_REQUEST_STATUS_META,
  RETURN_RESOLUTIONS,
  RETURN_RESOLUTION_META,
} from "@/lib/enums";
import { useQueryNav } from "@/hooks/use-query-nav";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { EntityPicker, type EntityRef } from "@/components/shared/entity-picker";
import { ExportButton } from "@/components/shared/export-button";
import { FilterTabs, SearchInput } from "@/components/shared/list-controls";

import type { ReturnStatusCounts } from "../queries";

/**
 * Every control writes to the URL and nothing else, so a filtered worklist is
 * a link somebody can paste to a colleague. The first tab row is the coarse
 * open/closed split an operations shift lives in; the status select underneath
 * is the fine-grained cut for a specific question ("what is stuck in QC?").
 */

const ALL = "__all";

function UrlSelect({
  paramKey,
  label,
  options,
  className,
}: {
  paramKey: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  className?: string;
}) {
  const searchParams = useSearchParams();
  const { navigate } = useQueryNav();
  const value = searchParams.get(paramKey) ?? ALL;
  return (
    <Select value={value} onValueChange={(next) => navigate({ [paramKey]: next === ALL ? null : next })}>
      <SelectTrigger size="sm" className={className ?? "w-40"} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ReturnsToolbar({
  statusCounts,
  seller,
  canExport,
  hasFilters,
}: {
  statusCounts: ReturnStatusCounts;
  seller: EntityRef | null;
  canExport: boolean;
  hasFilters: boolean;
}) {
  const searchParams = useSearchParams();
  const { navigate } = useQueryNav();

  const exportHref = (format: "csv" | "xlsx" | "print") => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    params.delete("pageSize");
    params.set("format", format);
    return `/api/admin/returns/export?${params.toString()}`;
  };

  const clearAll = () =>
    navigate({ q: null, state: null, status: null, reason: null, resolution: null, seller: null, customer: null, order: null, range: null, from: null, to: null });

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto pb-1">
        <FilterTabs
          paramKey="state"
          allLabel={`All (${statusCounts.all})`}
          options={[
            { value: "open", label: "Open", count: statusCounts.open },
            { value: "closed", label: "Closed", count: statusCounts.closed },
          ]}
        />
      </div>

      <DataTableToolbar
        search={<SearchInput placeholder="RMA, order no, customer, tracking…" className="w-full sm:w-80" />}
        filters={
          <>
            <UrlSelect
              paramKey="status"
              label="Any status"
              options={RETURN_REQUEST_STATUSES.map((status) => ({
                value: status,
                label: `${RETURN_REQUEST_STATUS_META[status].label}${statusCounts[status] ? ` (${statusCounts[status]})` : ""}`,
              }))}
              className="w-44"
            />
            <UrlSelect
              paramKey="reason"
              label="Any reason"
              options={RETURN_REASONS.map((reason) => ({ value: reason, label: RETURN_REASON_META[reason].label }))}
            />
            <UrlSelect
              paramKey="resolution"
              label="Any resolution"
              options={RETURN_RESOLUTIONS.map((value) => ({ value, label: RETURN_RESOLUTION_META[value].label }))}
              className="w-36"
            />
            <DateRangePicker />
            <div className="flex items-center gap-2">
              <Label className="text-muted-foreground text-xs">Seller</Label>
              <EntityPicker
                kind="seller"
                value={seller}
                onChange={(next) => navigate({ seller: next?.id ?? null })}
                placeholder="Any seller"
              />
            </div>
            {hasFilters ? (
              <Button variant="ghost" size="sm" onClick={clearAll}>
                <X /> Clear
              </Button>
            ) : null}
          </>
        }
        actions={canExport ? <ExportButton hrefFor={exportHref} size="sm" /> : undefined}
      />

      <p className="text-muted-foreground px-1 text-[11px]">
        “Open” means any of {OPEN_RETURN_STATUSES.length} live states — an open RMA holds the order in{" "}
        <span className="font-medium">Return requested</span> and keeps the seller’s earnings out of the next payout.
      </p>
    </div>
  );
}
