"use client";

import { Lock } from "lucide-react";
import { cn } from "cn";

import { RowCheckbox } from "@/components/shared/row-selection";
import { StatusPill } from "@/components/shared/status-badge";
import { MEDIA_VISIBILITY_META } from "@/lib/enums";

import { MediaThumb } from "@/features/media/components/media-preview";
import type { MediaAssetDto } from "@/features/media/dto";
import { formatBytes, formatDimensions } from "@/features/media/format";

/** The slice of `useRowSelection` the grid needs; the picker supplies its own. */
export type TileSelection = {
  isSelected(id: string): boolean;
  rowProps(id: string): { checked: boolean; onCheckedChange(checked: boolean | "indeterminate"): void };
};

/**
 * Tile grid. Clicking a tile opens the detail sheet (`?asset=<id>`); the
 * checkbox in the corner selects without opening, so bulk moves do not open
 * twenty sheets. Tiles are square so a mixed page of portrait photos, wide
 * banners and PDFs lines up.
 */
export function MediaGrid({
  rows,
  selection,
  onOpen,
  selectable = true,
  className,
}: {
  rows: MediaAssetDto[];
  selection?: TileSelection;
  onOpen(asset: MediaAssetDto): void;
  selectable?: boolean;
  className?: string;
}) {
  return (
    <ul
      role="list"
      className={cn("grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6", className)}
    >
      {rows.map((asset) => {
        const selected = selection?.isSelected(asset.id) ?? false;
        return (
          <li key={asset.id} className="group/tile relative">
            <button
              type="button"
              onClick={() => onOpen(asset)}
              aria-label={`Open ${asset.filename}`}
              className={cn(
                "bg-card block w-full overflow-hidden rounded-lg border text-left transition-colors outline-none",
                "hover:border-foreground/30 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3",
                selected && "border-brand ring-brand/30 ring-2",
              )}
            >
              <MediaThumb asset={asset} size="tile" />
              <div className="space-y-0.5 border-t px-2 py-1.5">
                <p className="truncate text-xs font-medium" title={asset.filename}>
                  {asset.filename}
                </p>
                <p data-numeric className="text-muted-foreground truncate text-[10px]">
                  {formatBytes(asset.sizeBytes)}
                  {asset.width && asset.height ? ` · ${formatDimensions(asset.width, asset.height)}` : ""}
                </p>
              </div>
            </button>

            {selectable && selection ? (
              <div
                className={cn(
                  "bg-background/90 absolute top-1.5 left-1.5 rounded p-0.5 transition-opacity",
                  selected ? "opacity-100" : "opacity-0 group-hover/tile:opacity-100 focus-within:opacity-100",
                )}
              >
                <RowCheckbox {...selection.rowProps(asset.id)} label={`Select ${asset.filename}`} />
              </div>
            ) : null}

            {asset.visibility === "PRIVATE" ? (
              <span className="absolute top-1.5 right-1.5" title={MEDIA_VISIBILITY_META.PRIVATE.description}>
                <StatusPill label="Private" tone="warning" dot={false} className="h-4 gap-1 px-1.5 text-[10px]" />
              </span>
            ) : asset.kind !== "image" ? (
              <span className="absolute top-1.5 right-1.5">
                <StatusPill label={asset.kind === "video" ? "Video" : "PDF"} tone={asset.kind === "video" ? "brand" : "neutral"} dot={false} className="h-4 px-1.5 text-[10px]" />
              </span>
            ) : null}
            {asset.visibility === "PRIVATE" ? <Lock className="sr-only" aria-hidden /> : null}
          </li>
        );
      })}
    </ul>
  );
}
