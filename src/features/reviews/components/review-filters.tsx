"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Camera, ShieldCheck, Star, X } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { EntityPicker, type EntityRef } from "@/components/shared/entity-picker";
import { ExportButton } from "@/components/shared/export-button";
import { useQueryNav } from "@/hooks/use-query-nav";

import type { ReviewFilterRefs } from "@/features/reviews/types";

/**
 * Secondary filters for /admin/reviews. Everything writes to the URL and the
 * page re-renders on the server; the EntityPicker chips are hydrated from
 * `refs` so a link like /admin/reviews?seller=<id> shows the seller's name
 * on first paint.
 */
const selectClass =
  "border-input bg-background h-8 rounded-md border px-2 text-xs shadow-xs focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none";

function Toggle({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-pressed={active}
      className={cn(active && "border-brand text-brand bg-brand-muted")}
      onClick={onClick}
    >
      <Icon />
      {children}
    </Button>
  );
}

export function ReviewFilters({ refs, showStatusFilters = true }: { refs: ReviewFilterRefs; showStatusFilters?: boolean }) {
  const { navigate, searchParams } = useQueryNav();
  const rating = searchParams.get("rating") ?? "";
  const verified = searchParams.get("verified") === "1";
  const images = searchParams.get("images") === "1";
  const featured = searchParams.get("featured") === "1";

  const toRef = (chip: ReviewFilterRefs["product"]): EntityRef | null =>
    chip ? { id: chip.id, title: chip.title, subtitle: chip.subtitle, imageUrl: chip.imageUrl ?? undefined } : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Filter by rating" className={selectClass} value={rating} onChange={(event) => navigate({ rating: event.target.value || null })}>
        <option value="">Any rating</option>
        {[5, 4, 3, 2, 1].map((value) => (
          <option key={value} value={value}>
            {value} star{value === 1 ? "" : "s"}
          </option>
        ))}
      </select>
      {showStatusFilters ? (
        <>
          <div className="w-52">
            <EntityPicker
              kind="product"
              value={toRef(refs.product)}
              onChange={(value) => navigate({ product: value?.id ?? null })}
              placeholder="Any product"
            />
          </div>
          <div className="w-48">
            <EntityPicker kind="seller" value={toRef(refs.seller)} onChange={(value) => navigate({ seller: value?.id ?? null })} placeholder="Any seller" />
          </div>
          <Toggle active={verified} onClick={() => navigate({ verified: verified ? null : "1" })} icon={ShieldCheck}>
            Verified
          </Toggle>
          <Toggle active={images} onClick={() => navigate({ images: images ? null : "1" })} icon={Camera}>
            With photos
          </Toggle>
        </>
      ) : null}
      <Toggle active={featured} onClick={() => navigate({ featured: featured ? null : "1" })} icon={Star}>
        Featured
      </Toggle>
      <DateRangePicker fallback="this_year" />
      {refs.customer ? (
        <Button type="button" variant="outline" size="sm" onClick={() => navigate({ customer: null })} aria-label="Clear customer filter">
          Customer: {refs.customer.title}
          <X />
        </Button>
      ) : null}
    </div>
  );
}

/** Streams the CURRENT filters to /api/admin/reviews/export so the file matches the screen. */
export function ReviewExportButton() {
  const searchParams = useSearchParams();
  return (
    <ExportButton
      formats={["csv", "xlsx"]}
      hrefFor={(format) => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("page");
        params.delete("pageSize");
        params.delete("review");
        params.set("format", format);
        return `/api/admin/reviews/export?${params.toString()}`;
      }}
    />
  );
}
