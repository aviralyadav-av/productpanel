"use client";

import * as React from "react";
import { X } from "lucide-react";

import { MultiSelect } from "@/components/shared/combobox";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { EntityPicker, type EntityRef } from "@/components/shared/entity-picker";
import { MoneyInput } from "@/components/shared/money-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useQueryNav } from "@/hooks/use-query-nav";

import { CategorySelect } from "@/features/products/components/category-select";
import { PRODUCT_FLAGS, PRODUCT_FLAG_LABELS, STOCK_FILTERS, STOCK_FILTER_LABELS, type ProductListFilters } from "@/features/products/filters";
import type { AttributeCatalogEntry, CategoryOption } from "@/features/products/queries";

/**
 * Every filter of the product list, all writing to the URL through
 * useQueryNav (the page is a Server Component that re-queries from
 * searchParams). Price inputs commit on blur/Enter rather than per keystroke
 * so typing "1200" does not run four queries.
 */
export function ProductFilters({
  filters,
  categories,
  attributes,
  seller,
}: {
  filters: ProductListFilters;
  categories: CategoryOption[];
  attributes: AttributeCatalogEntry[];
  /** Hydrated seller for the picker chip when ?seller= is set. */
  seller: EntityRef | null;
}) {
  const { navigate } = useQueryNav();
  const [minPaise, setMinPaise] = React.useState<number | null>(filters.minPricePaise ?? null);
  const [maxPaise, setMaxPaise] = React.useState<number | null>(filters.maxPricePaise ?? null);

  const commitPrice = () => {
    navigate({
      minPrice: minPaise === null ? null : String(minPaise / 100),
      maxPrice: maxPaise === null ? null : String(maxPaise / 100),
    });
  };

  const sellerValue: EntityRef | null = filters.platformOnly ? { id: "platform", title: "Platform (no seller)" } : seller;
  const attributeByCode = new Map(attributes.map((attribute) => [attribute.code, attribute]));

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <CategorySelect
        categories={categories}
        value={filters.categoryId ?? null}
        onChange={(value) => navigate({ category: value })}
        includeNone
        className="w-56"
      />
      {filters.categoryId && filters.categoryId !== "none" ? (
        <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Switch
            checked={filters.includeDescendants}
            onCheckedChange={(checked) => navigate({ includeDescendants: checked ? null : "0" })}
            aria-label="Include subcategories"
          />
          Subcategories
        </label>
      ) : null}

      <EntityPicker
        kind="seller"
        value={sellerValue}
        onChange={(ref) => navigate({ seller: ref?.id ?? null })}
        placeholder="Any seller"
        className="w-52"
      />
      <Button
        type="button"
        variant={filters.platformOnly ? "secondary" : "outline"}
        size="sm"
        onClick={() => navigate({ seller: filters.platformOnly ? null : "platform" })}
      >
        Platform only
      </Button>

      <Select value={filters.stock ?? "any"} onValueChange={(value) => navigate({ stock: value === "any" ? null : value })}>
        <SelectTrigger size="sm" className="w-36" aria-label="Stock">
          <SelectValue placeholder="Any stock" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Any stock</SelectItem>
          {STOCK_FILTERS.map((value) => (
            <SelectItem key={value} value={value}>
              {STOCK_FILTER_LABELS[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1" onKeyDown={(event) => event.key === "Enter" && commitPrice()}>
        <MoneyInput valuePaise={minPaise} onChangePaise={setMinPaise} placeholder="Min ₹" allowEmpty className="w-24" />
        <span className="text-muted-foreground text-xs">to</span>
        <MoneyInput valuePaise={maxPaise} onChangePaise={setMaxPaise} placeholder="Max ₹" allowEmpty className="w-24" />
        {(minPaise ?? null) !== (filters.minPricePaise ?? null) || (maxPaise ?? null) !== (filters.maxPricePaise ?? null) ? (
          <Button type="button" size="xs" variant="secondary" onClick={commitPrice}>
            Apply
          </Button>
        ) : null}
      </div>

      <DateRangePicker />

      <MultiSelect
        options={PRODUCT_FLAGS.map((flag) => ({ value: flag, label: PRODUCT_FLAG_LABELS[flag] }))}
        value={filters.flags}
        onChange={(flags) => navigate({ flags: flags.length ? flags.join(",") : null })}
        placeholder="Flags"
        maxVisibleChips={2}
        className="w-44"
      />

      {Object.entries(filters.attr).map(([code, value]) => {
        const attribute = attributeByCode.get(code);
        const labels = attribute
          ? value
              .split(",")
              .map((part) => attribute.values.find((item) => item.value === part || item.id === part)?.label ?? part)
              .join(", ")
          : value;
        return (
          <span key={code} className="bg-muted inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs">
            <span className="text-muted-foreground">{attribute?.name ?? code}:</span> {labels}
            <button type="button" aria-label={`Clear ${code} filter`} onClick={() => navigate({ [`attr[${code}]`]: null })}>
              <X className="size-3" />
            </button>
          </span>
        );
      })}

      <Label className="sr-only">Filters</Label>
    </div>
  );
}
