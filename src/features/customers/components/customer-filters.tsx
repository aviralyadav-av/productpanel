"use client";

import { X } from "lucide-react";

import { MultiSelect } from "@/components/shared/combobox";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CUSTOMER_STATUS_META, CUSTOMER_STATUSES } from "@/lib/enums";
import { useQueryNav } from "@/hooks/use-query-nav";

import { hasActiveFilters, type CustomerListFilters } from "@/features/customers/filters";

/**
 * Secondary filters for the customer list (status, marketing consent, tags,
 * registered window). All of them write to the URL through useQueryNav; the
 * Server Component page re-queries from searchParams.
 */
export function CustomerFilters({ filters, tagSuggestions }: { filters: CustomerListFilters; tagSuggestions: string[] }) {
  const { navigate } = useQueryNav();
  const marketingValue = filters.acceptsMarketing === undefined ? "any" : filters.acceptsMarketing ? "1" : "0";
  const tagOptions = [...new Set([...tagSuggestions, ...filters.tags])].map((tag) => ({ value: tag, label: tag }));

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <Select value={filters.status ?? "any"} onValueChange={(value) => navigate({ status: value === "any" ? null : value })}>
        <SelectTrigger size="sm" className="w-36" aria-label="Status">
          <SelectValue placeholder="Any status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Any status</SelectItem>
          {CUSTOMER_STATUSES.map((status) => (
            <SelectItem key={status} value={status}>
              {CUSTOMER_STATUS_META[status].label}
            </SelectItem>
          ))}
          <SelectItem value="DELETED">Deleted</SelectItem>
        </SelectContent>
      </Select>

      <Select value={marketingValue} onValueChange={(value) => navigate({ marketing: value === "any" ? null : value })}>
        <SelectTrigger size="sm" className="w-40" aria-label="Marketing consent">
          <SelectValue placeholder="Marketing" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Any consent</SelectItem>
          <SelectItem value="1">Accepts marketing</SelectItem>
          <SelectItem value="0">No marketing</SelectItem>
        </SelectContent>
      </Select>

      <MultiSelect
        options={tagOptions}
        value={filters.tags}
        onChange={(tags) => navigate({ tags: tags.length ? tags.join(",") : null })}
        placeholder="Tags"
        emptyText="No tags yet"
        maxVisibleChips={2}
        className="w-48"
      />

      <DateRangePicker />

      {hasActiveFilters(filters) ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => navigate({ q: null, segment: null, status: null, marketing: null, tags: null, range: null, from: null, to: null })}
        >
          <X /> Clear
        </Button>
      ) : null}
    </div>
  );
}
