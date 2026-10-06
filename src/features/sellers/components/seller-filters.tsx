"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { FileWarning } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { ExportButton } from "@/components/shared/export-button";
import { useQueryNav } from "@/hooks/use-query-nav";

import type { SellerFilterOptions } from "@/features/sellers/types";

/**
 * Secondary filters for the seller list. Native <select>s on purpose: the
 * value goes straight to the URL and the page re-renders on the server, so a
 * Radix Select with client state would be more code for a worse back button.
 */
export function SellerFilters({ options }: { options: SellerFilterOptions }) {
  const { navigate, searchParams } = useQueryNav();
  const state = searchParams.get("state") ?? "";
  const city = searchParams.get("city") ?? "";
  const minRating = searchParams.get("minRating") ?? "";
  const pendingDocs = searchParams.get("pendingDocs") === "1";

  const selectClass =
    "border-input bg-background h-8 rounded-md border px-2 text-xs shadow-xs focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Filter by state"
        className={selectClass}
        value={state}
        onChange={(event) => navigate({ state: event.target.value || null, city: null })}
      >
        <option value="">All states</option>
        {options.states.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
      <select aria-label="Filter by city" className={selectClass} value={city} onChange={(event) => navigate({ city: event.target.value || null })}>
        <option value="">All cities</option>
        {options.cities.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
      <select
        aria-label="Minimum rating"
        className={selectClass}
        value={minRating}
        onChange={(event) => navigate({ minRating: event.target.value || null })}
      >
        <option value="">Any rating</option>
        <option value="4">4★ and up</option>
        <option value="3">3★ and up</option>
        <option value="2">2★ and up</option>
      </select>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-pressed={pendingDocs}
        className={cn(pendingDocs && "border-warning text-warning bg-warning-muted")}
        onClick={() => navigate({ pendingDocs: pendingDocs ? null : "1" })}
      >
        <FileWarning />
        Pending documents
      </Button>
    </div>
  );
}

/** Streams the CURRENT filters to /api/admin/sellers/export so the file matches the screen. */
export function SellerExportButton() {
  const searchParams = useSearchParams();
  return (
    <ExportButton
      formats={["csv", "xlsx"]}
      hrefFor={(format) => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("page");
        params.delete("pageSize");
        params.set("format", format);
        return `/api/admin/sellers/export?${params.toString()}`;
      }}
    />
  );
}
