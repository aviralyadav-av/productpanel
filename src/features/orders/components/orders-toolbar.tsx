"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Filter, X } from "lucide-react";

import {
  ORDER_SOURCES,
  ORDER_SOURCE_META,
  ORDER_STATUSES,
  ORDER_STATUS_META,
  PAYMENT_METHODS,
  PAYMENT_METHOD_META,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_META,
} from "@/lib/enums";
import { useQueryNav } from "@/hooks/use-query-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { EntityPicker, type EntityRef } from "@/components/shared/entity-picker";
import { ExportButton } from "@/components/shared/export-button";
import { FilterTabs, SearchInput } from "@/components/shared/list-controls";

import type { OrderStatusCounts } from "../queries";

/**
 * Every control writes to the URL and nothing else (§7): the page is a Server
 * Component that re-queries from searchParams, so there is no client list
 * state to keep in sync and a filtered view can be pasted to a colleague.
 *
 * The four tabs the sidebar links to (PENDING, PROCESSING, SHIPPED,
 * DELIVERED) are the same `?status=` parameter, so arriving from the nav and
 * clicking a tab land in exactly the same place.
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
      <SelectTrigger size="sm" className={className ?? "w-36"} aria-label={label}>
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

/** Amount bounds are typed in rupees; the query layer converts to paise. */
function AmountRange() {
  const searchParams = useSearchParams();
  const { navigate } = useQueryNav();
  const [min, setMin] = React.useState(searchParams.get("minTotal") ?? "");
  const [max, setMax] = React.useState(searchParams.get("maxTotal") ?? "");

  const apply = () => navigate({ minTotal: min.trim() || null, maxTotal: max.trim() || null });

  return (
    <div className="grid gap-2">
      <Label className="text-xs">Order total (₹)</Label>
      <div className="flex items-center gap-2">
        <Input
          inputMode="decimal"
          value={min}
          onChange={(event) => setMin(event.target.value)}
          onBlur={apply}
          placeholder="Min"
          className="h-8 w-24"
          aria-label="Minimum order total in rupees"
        />
        <span className="text-muted-foreground text-xs">to</span>
        <Input
          inputMode="decimal"
          value={max}
          onChange={(event) => setMax(event.target.value)}
          onBlur={apply}
          placeholder="Max"
          className="h-8 w-24"
          aria-label="Maximum order total in rupees"
        />
      </div>
    </div>
  );
}

function BooleanFilter({ paramKey, label, hint }: { paramKey: string; label: string; hint: string }) {
  const searchParams = useSearchParams();
  const { navigate } = useQueryNav();
  const checked = searchParams.get(paramKey) === "1";
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Label className="text-xs">{label}</Label>
        <p className="text-muted-foreground text-[11px] leading-tight">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={(next) => navigate({ [paramKey]: next ? "1" : null })} aria-label={label} />
    </div>
  );
}

export function OrdersToolbar({
  statusCounts,
  seller,
  customer,
  canExport,
  hasFilters,
}: {
  statusCounts: OrderStatusCounts;
  seller: EntityRef | null;
  customer: EntityRef | null;
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
    return `/api/admin/orders/export?${params.toString()}`;
  };

  const clearAll = () =>
    navigate({
      q: null,
      status: null,
      payment: null,
      method: null,
      source: null,
      seller: null,
      customer: null,
      range: null,
      from: null,
      to: null,
      minTotal: null,
      maxTotal: null,
      returns: null,
      custom: null,
    });

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto pb-1">
        <FilterTabs
          paramKey="status"
          allLabel={`All (${statusCounts.all})`}
          options={ORDER_STATUSES.map((status) => ({
            value: status,
            label: ORDER_STATUS_META[status].label,
            count: statusCounts[status],
          }))}
        />
      </div>

      <DataTableToolbar
        search={<SearchInput placeholder="Order no, customer, phone, tracking, product…" className="w-full sm:w-80" />}
        filters={
          <>
            <UrlSelect
              paramKey="payment"
              label="Any payment"
              options={PAYMENT_STATUSES.map((status) => ({ value: status, label: PAYMENT_STATUS_META[status].label }))}
            />
            <UrlSelect
              paramKey="method"
              label="Any method"
              options={PAYMENT_METHODS.map((method) => ({ value: method, label: PAYMENT_METHOD_META[method].label }))}
              className="w-32"
            />
            <DateRangePicker />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <Filter /> More filters
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 space-y-4">
                <div className="grid gap-2">
                  <Label className="text-xs">Seller</Label>
                  <EntityPicker
                    kind="seller"
                    value={seller}
                    onChange={(next) => navigate({ seller: next?.id ?? null })}
                    placeholder="Any seller"
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="text-xs">Customer</Label>
                  <EntityPicker
                    kind="customer"
                    value={customer}
                    onChange={(next) => navigate({ customer: next?.id ?? null })}
                    placeholder="Any customer"
                  />
                </div>
                <AmountRange />
                <div className="grid gap-2">
                  <Label className="text-xs">Source</Label>
                  <UrlSelect
                    paramKey="source"
                    label="Any source"
                    options={ORDER_SOURCES.map((source) => ({ value: source, label: ORDER_SOURCE_META[source].label }))}
                    className="w-full"
                  />
                </div>
                <BooleanFilter paramKey="returns" label="Has returns" hint="Orders with at least one RMA." />
                <BooleanFilter paramKey="custom" label="Has customisation" hint="Orders with a personalised line." />
              </PopoverContent>
            </Popover>
            {hasFilters ? (
              <Button variant="ghost" size="sm" onClick={clearAll}>
                <X /> Clear
              </Button>
            ) : null}
          </>
        }
        actions={canExport ? <ExportButton hrefFor={exportHref} size="sm" /> : undefined}
      />
    </div>
  );
}
