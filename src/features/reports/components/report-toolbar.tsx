"use client";

import * as React from "react";
import { X } from "lucide-react";
import { useSearchParams } from "next/navigation";

import {
  ORDER_STATUSES,
  ORDER_STATUS_META,
  PAYMENT_METHODS,
  PAYMENT_METHOD_META,
  PAYOUT_STATUSES,
  PAYOUT_STATUS_META,
  REFUND_METHODS,
  REFUND_METHOD_META,
  REFUND_STATUSES,
  REFUND_STATUS_META,
  STOCK_STATES,
  STOCK_STATE_META,
} from "@/lib/enums";
import { useQueryNav } from "@/hooks/use-query-nav";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { EntityPicker, type EntityRef } from "@/components/shared/entity-picker";
import { ExportButton } from "@/components/shared/export-button";

import { BUCKETS, BUCKET_LABELS } from "../bucketing";
import type { ReportFilterRefs } from "../queries";
import { REPORT_FILTER_PARAMS } from "../schemas";
import type { ReportFilterKey, ReportSummary } from "../types";

/**
 * The filter strip for one report: date range, the controls the report
 * declared in its `filters` list, and the export menu.
 *
 * Every control writes to the URL and nothing else (house rule: list state
 * lives in the URL), so the Server Component page re-queries and the export
 * links simply forward the same query string to the API. That is what makes
 * the downloaded file exactly the view on screen, which is in turn what makes
 * auditing an export by its filters meaningful (D13).
 */

const ALL = "__all";

function FilterSelect({
  paramKey,
  label,
  options,
  width = "w-40",
}: {
  paramKey: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  width?: string;
}) {
  const searchParams = useSearchParams();
  const { navigate } = useQueryNav();
  const value = searchParams.get(paramKey) ?? ALL;

  return (
    <Select value={value} onValueChange={(next) => navigate({ [paramKey]: next === ALL ? null : next })}>
      <SelectTrigger size="sm" className={width} aria-label={label}>
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

/** An EntityPicker bound to one URL param; the chip label comes from the server-resolved ref. */
function EntityFilter({
  paramKey,
  kind,
  placeholder,
  current,
}: {
  paramKey: string;
  kind: "seller" | "category" | "product" | "coupon";
  placeholder: string;
  current?: EntityRef;
}) {
  const { navigate } = useQueryNav();
  return (
    <EntityPicker
      kind={kind}
      value={current ?? null}
      onChange={(next) => navigate({ [paramKey]: next?.id ?? null })}
      placeholder={placeholder}
      className="w-56"
    />
  );
}

function enumOptions(values: readonly string[], meta: Record<string, { label: string }>) {
  return values.map((value) => ({ value, label: meta[value]?.label ?? value }));
}

export function ReportToolbar({
  report,
  refs,
  hasFilters,
  canExport,
}: {
  report: ReportSummary;
  refs: ReportFilterRefs;
  hasFilters: boolean;
  canExport: boolean;
}) {
  const searchParams = useSearchParams();
  const { navigate } = useQueryNav();

  /** The export carries the current view minus paging: a file is never one page. */
  const exportHref = React.useCallback(
    (format: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("page");
      params.delete("pageSize");
      params.set("format", format);
      return `/api/admin/reports/${report.key}?${params.toString()}`;
    },
    [searchParams, report.key],
  );

  function clearFilters() {
    const changes: Record<string, null> = {};
    for (const param of Object.values(REPORT_FILTER_PARAMS)) changes[param] = null;
    navigate(changes);
  }

  const shows = (key: ReportFilterKey) => report.filters.includes(key);

  return (
    <DataTableToolbar
      filters={
        <>
          <DateRangePicker />

          {shows("bucket") ? (
            <FilterSelect
              paramKey={REPORT_FILTER_PARAMS.bucket}
              label="Automatic grouping"
              options={BUCKETS.map((bucket) => ({ value: bucket, label: BUCKET_LABELS[bucket] }))}
              width="w-36"
            />
          ) : null}

          {shows("groupBy") && report.groupByOptions ? (
            <FilterSelect
              paramKey={REPORT_FILTER_PARAMS.groupBy}
              label="Default grouping"
              options={report.groupByOptions}
            />
          ) : null}

          {shows("level") ? (
            <FilterSelect
              paramKey={REPORT_FILTER_PARAMS.level}
              label="Roll up to top level"
              options={[
                { value: "root", label: "Top-level categories" },
                { value: "leaf", label: "Exact category" },
              ]}
              width="w-44"
            />
          ) : null}

          {shows("seller") ? (
            <EntityFilter
              paramKey={REPORT_FILTER_PARAMS.seller}
              kind="seller"
              placeholder="All sellers"
              current={refs.seller}
            />
          ) : null}

          {shows("category") ? (
            <EntityFilter
              paramKey={REPORT_FILTER_PARAMS.category}
              kind="category"
              placeholder="All categories"
              current={refs.category}
            />
          ) : null}

          {shows("product") ? (
            <EntityFilter
              paramKey={REPORT_FILTER_PARAMS.product}
              kind="product"
              placeholder="All products"
              current={refs.product}
            />
          ) : null}

          {shows("coupon") ? (
            <EntityFilter
              paramKey={REPORT_FILTER_PARAMS.coupon}
              kind="coupon"
              placeholder="All coupons"
              current={refs.coupon}
            />
          ) : null}

          {shows("status") ? (
            <FilterSelect
              paramKey={REPORT_FILTER_PARAMS.status}
              label="Any order status"
              options={enumOptions(ORDER_STATUSES, ORDER_STATUS_META)}
            />
          ) : null}

          {shows("paymentMethod") ? (
            <FilterSelect
              paramKey={REPORT_FILTER_PARAMS.paymentMethod}
              label="Any payment method"
              options={enumOptions(PAYMENT_METHODS, PAYMENT_METHOD_META)}
              width="w-40"
            />
          ) : null}

          {shows("payoutStatus") ? (
            <FilterSelect
              paramKey={REPORT_FILTER_PARAMS.payoutStatus}
              label="Any payout status"
              options={enumOptions(PAYOUT_STATUSES, PAYOUT_STATUS_META)}
            />
          ) : null}

          {shows("refundStatus") ? (
            <FilterSelect
              paramKey={REPORT_FILTER_PARAMS.refundStatus}
              label="Any refund status"
              options={enumOptions(REFUND_STATUSES, REFUND_STATUS_META)}
            />
          ) : null}

          {shows("refundMethod") ? (
            <FilterSelect
              paramKey={REPORT_FILTER_PARAMS.refundMethod}
              label="Any refund method"
              options={enumOptions(REFUND_METHODS, REFUND_METHOD_META)}
            />
          ) : null}

          {shows("stockState") ? (
            <FilterSelect
              paramKey={REPORT_FILTER_PARAMS.stockState}
              label="Any stock state"
              options={enumOptions(STOCK_STATES, STOCK_STATE_META)}
            />
          ) : null}

          {shows("buyerType") ? (
            <FilterSelect
              paramKey={REPORT_FILTER_PARAMS.buyerType}
              label="New and returning"
              options={[
                { value: "new", label: "First-time buyers" },
                { value: "returning", label: "Returning buyers" },
              ]}
              width="w-44"
            />
          ) : null}

          {hasFilters ? (
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
              <X /> Clear filters
            </Button>
          ) : null}
        </>
      }
      actions={
        canExport ? (
          <ExportButton
            formats={["csv", "xlsx", "print"]}
            hrefFor={(format) => exportHref(format)}
            onExport={(format) => {
              // The print view is an HTML page the browser prints, not a
              // download, so it opens in a tab instead of an <a download>.
              if (format === "print") window.open(exportHref("print"), "_blank", "noopener");
            }}
          />
        ) : null
      }
    />
  );
}
