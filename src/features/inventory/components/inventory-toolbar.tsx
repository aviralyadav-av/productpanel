"use client";

import * as React from "react";

import type { CategoryOption } from "@/features/inventory/queries";
import { EntityPicker, type EntityRef } from "@/components/shared/entity-picker";
import { ExportButton } from "@/components/shared/export-button";
import { FilterTabs, SearchInput } from "@/components/shared/list-controls";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryNav } from "@/hooks/use-query-nav";
import { STOCK_STATE_META, STOCK_STATES, type StockState } from "@/lib/enums";

const ALL_CATEGORIES = "__all";

/**
 * Every control writes to the URL; the Server Component re-queries. The
 * category select lists the whole tree indented by depth and filters
 * descendants too, so picking "Home Decor" also shows "Home Decor › Wall Art".
 */
export function InventoryToolbar({
  counts,
  categories,
  categoryId,
  seller,
  columnsMenu,
}: {
  counts: Record<StockState, number>;
  categories: CategoryOption[];
  categoryId: string | undefined;
  seller: EntityRef | null;
  columnsMenu: React.ReactNode;
}) {
  const { navigate, searchParams } = useQueryNav();

  const exportHref = (format: "csv" | "xlsx") => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    params.delete("variant");
    params.set("format", format);
    params.set("scope", "levels");
    return `/api/admin/inventory/export?${params.toString()}`;
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput placeholder="Search SKU, product or variant…" className="w-full sm:w-64" />
        <FilterTabs
          paramKey="stock"
          allLabel="All"
          options={STOCK_STATES.map((state) => ({
            value: state,
            label: STOCK_STATE_META[state].label,
            count: counts[state],
          }))}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={categoryId ?? ALL_CATEGORIES}
          onValueChange={(value) => navigate({ category: value === ALL_CATEGORIES ? null : value })}
        >
          <SelectTrigger className="h-8 w-full sm:w-56" aria-label="Filter by category">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                <span style={{ paddingLeft: `${Math.min(category.depth, 6) * 0.75}rem` }}>{category.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <EntityPicker
          kind="seller"
          value={seller}
          onChange={(next) => navigate({ seller: next?.id ?? null })}
          placeholder="Any seller"
          className="w-full sm:w-56"
        />

        <div className="ml-auto flex items-center gap-2">
          {columnsMenu}
          <ExportButton hrefFor={exportHref} />
        </div>
      </div>
    </div>
  );
}
