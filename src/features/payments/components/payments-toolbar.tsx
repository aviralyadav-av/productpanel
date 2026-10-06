"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { Settings2, X } from "lucide-react";

import {
  PAYMENT_INSTRUMENTS,
  PAYMENT_INSTRUMENT_META,
  PAYMENT_PROVIDERS,
  PAYMENT_PROVIDER_META,
  PAYMENT_TRANSACTION_STATUSES,
  PAYMENT_TRANSACTION_STATUS_META,
  PAYMENT_TYPES,
  PAYMENT_TYPE_META,
} from "@/lib/enums";
import { useQueryNav } from "@/hooks/use-query-nav";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { ExportButton } from "@/components/shared/export-button";
import { FilterTabs, SearchInput } from "@/components/shared/list-controls";

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

export function PaymentsToolbar({
  canExport,
  canManage,
  hasFilters,
}: {
  canExport: boolean;
  canManage: boolean;
  hasFilters: boolean;
}) {
  const searchParams = useSearchParams();
  const { navigate } = useQueryNav();

  const exportHref = (format: "csv" | "xlsx" | "print") => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    params.delete("pageSize");
    params.set("format", format);
    return `/api/admin/payments/export?${params.toString()}`;
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto pb-1">
        <FilterTabs
          paramKey="type"
          allLabel="All transactions"
          options={PAYMENT_TYPES.map((type) => ({ value: type, label: PAYMENT_TYPE_META[type].label }))}
        />
      </div>

      <DataTableToolbar
        search={<SearchInput placeholder="Transaction id, order no, customer email…" className="w-full sm:w-80" />}
        filters={
          <>
            <UrlSelect
              paramKey="provider"
              label="Any gateway"
              options={PAYMENT_PROVIDERS.map((provider) => ({ value: provider, label: PAYMENT_PROVIDER_META[provider].label }))}
            />
            <UrlSelect
              paramKey="method"
              label="Any method"
              options={PAYMENT_INSTRUMENTS.map((method) => ({ value: method, label: PAYMENT_INSTRUMENT_META[method].label }))}
            />
            <UrlSelect
              paramKey="status"
              label="Any status"
              options={PAYMENT_TRANSACTION_STATUSES.map((status) => ({ value: status, label: PAYMENT_TRANSACTION_STATUS_META[status].label }))}
            />
            <DateRangePicker />
            {hasFilters ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate({ q: null, provider: null, method: null, type: null, status: null, order: null, customer: null, range: null, from: null, to: null })}
              >
                <X /> Clear
              </Button>
            ) : null}
          </>
        }
        actions={
          <>
            {canManage ? (
              <Button asChild variant="outline" size="sm">
                <Link href={"/admin/settings?tab=payments" as Route}>
                  <Settings2 /> Providers
                </Link>
              </Button>
            ) : null}
            {canExport ? <ExportButton hrefFor={exportHref} size="sm" /> : null}
          </>
        }
      />
    </div>
  );
}
