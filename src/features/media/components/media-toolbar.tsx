"use client";

import { ArrowDownAZ, ArrowUpAZ, LayoutGrid, List } from "lucide-react";

import { FilterTabs, SearchInput } from "@/components/shared/list-controls";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useQueryNav } from "@/hooks/use-query-nav";
import { MEDIA_KINDS, MEDIA_KIND_META, MEDIA_VISIBILITIES, MEDIA_VISIBILITY_META } from "@/lib/enums";

import type { MediaKindCounts } from "@/features/media/queries";
import { MEDIA_SORTS, type MediaSort, type MediaView } from "@/features/media/schemas";

/**
 * Every control writes to the URL (search, kind, visibility, sort, view), so
 * the grid is a Server Component re-rendered from searchParams and the
 * current view is a pasteable link.
 */

const ALL = "all";

const SORT_LABEL: Record<MediaSort, string> = {
  createdAt: "Uploaded",
  updatedAt: "Modified",
  filename: "Name",
  sizeBytes: "Size",
};

export function MediaToolbar({
  counts,
  sort,
  order,
  view,
}: {
  counts: MediaKindCounts;
  sort: MediaSort;
  order: "asc" | "desc";
  view: MediaView;
}) {
  const { navigate, searchParams } = useQueryNav();
  const visibility = searchParams.get("visibility") ?? ALL;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput placeholder="Search filename, alt text or id…" className="w-full sm:w-64" />

      <FilterTabs
        paramKey="kind"
        allLabel="All"
        options={MEDIA_KINDS.map((kind) => ({
          value: kind,
          label: `${MEDIA_KIND_META[kind].label}s`,
          count: counts[kind],
        }))}
      />

      <Select value={visibility} onValueChange={(value) => navigate({ visibility: value === ALL ? null : value })}>
        <SelectTrigger size="sm" className="w-32" aria-label="Visibility">
          <SelectValue placeholder="Visibility" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any visibility</SelectItem>
          {MEDIA_VISIBILITIES.map((value) => (
            <SelectItem key={value} value={value}>
              {MEDIA_VISIBILITY_META[value].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="ml-auto flex items-center gap-1">
        <Select value={sort} onValueChange={(value) => navigate({ sort: value === "createdAt" ? null : value })}>
          <SelectTrigger size="sm" className="w-28" aria-label="Sort by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MEDIA_SORTS.map((value) => (
              <SelectItem key={value} value={value}>
                {SORT_LABEL[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={order === "asc" ? "Ascending - switch to descending" : "Descending - switch to ascending"}
          onClick={() => navigate({ order: order === "asc" ? null : "asc" })}
        >
          {order === "asc" ? <ArrowUpAZ /> : <ArrowDownAZ />}
        </Button>

        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={view}
          onValueChange={(value) => value && navigate({ view: value === "grid" ? null : value })}
          aria-label="View"
          className="ml-1"
        >
          <ToggleGroupItem value="grid" aria-label="Grid view">
            <LayoutGrid />
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="List view">
            <List />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  );
}
