"use client";

import { useSearchParams } from "next/navigation";

import { COUPON_STATUSES, COUPON_STATUS_META, COUPON_TYPES, COUPON_TYPE_META, type CouponStatus } from "@/lib/enums";
import { useQueryNav } from "@/hooks/use-query-nav";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { ExportButton } from "@/components/shared/export-button";
import { FilterTabs, SearchInput } from "@/components/shared/list-controls";

/**
 * Every control writes to the URL (§7 list state), so the Server Component
 * page re-reads and re-queries; nothing here holds list state of its own.
 */

const ALL = "__all";

/** A URL-backed select: `?<paramKey>=<value>`, cleared when "all" is chosen. Shared by the marketing list toolbars. */
export function ParamSelect({
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

export function CouponsToolbar({ statusCounts }: { statusCounts: Record<CouponStatus, number> }) {
  const searchParams = useSearchParams();

  const exportHref = (format: "csv" | "xlsx") => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    params.delete("pageSize");
    params.set("format", format);
    return `/api/admin/coupons/export?${params.toString()}`;
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <FilterTabs
          paramKey="status"
          options={COUPON_STATUSES.map((status) => ({ value: status, label: COUPON_STATUS_META[status].label, count: statusCounts[status] }))}
        />
      </div>
      <DataTableToolbar
        search={<SearchInput placeholder="Search code or name…" className="w-full sm:w-64" />}
        filters={
          <>
            <ParamSelect paramKey="type" label="All types" options={COUPON_TYPES.map((type) => ({ value: type, label: COUPON_TYPE_META[type].label }))} />
            <ParamSelect
              paramKey="fundedBy"
              label="Any funder"
              options={[
                { value: "PLATFORM", label: "Platform-funded" },
                { value: "SELLER", label: "Seller-funded" },
              ]}
            />
          </>
        }
        actions={<ExportButton hrefFor={exportHref} size="sm" />}
      />
    </div>
  );
}
