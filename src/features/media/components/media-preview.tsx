"use client";

import * as React from "react";
import { ExternalLink, Lock } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";

import type { MediaAssetDto } from "@/features/media/dto";
import { KIND_ICON, fileExtension, previewSrc } from "@/features/media/format";

/**
 * Thumbnail for grid tiles and table rows. A plain <img>: these are our own
 * random-keyed, immutable-cached files (or the admin file route for PRIVATE
 * ones), so next/image would add a remotePatterns entry and an optimiser
 * round-trip for a 160px tile and gain nothing.
 */
export function MediaThumb({
  asset,
  className,
  size = "tile",
}: {
  asset: MediaAssetDto;
  className?: string;
  size?: "row" | "tile";
}) {
  const [failed, setFailed] = React.useState(false);
  const src = previewSrc(asset);
  const Icon = KIND_ICON[asset.kind];

  const shell = cn(
    "bg-muted text-muted-foreground/70 flex items-center justify-center overflow-hidden",
    size === "row" ? "size-9 shrink-0 rounded border" : "aspect-square w-full",
    className,
  );

  if (!src || failed) {
    return (
      <div className={shell} aria-hidden>
        <div className="flex flex-col items-center gap-1">
          <Icon className={size === "row" ? "size-4" : "size-7"} />
          {size === "tile" ? <span className="text-[10px] font-medium tracking-wide">{fileExtension(asset.filename)}</span> : null}
        </div>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- own immutable files; see doc comment
    <img
      src={src}
      alt={asset.alt ?? asset.filename}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn(shell, size === "tile" ? "object-contain" : "object-cover")}
    />
  );
}

/** Large preview for the detail sheet and the picker's selection pane. */
export function MediaPreview({ asset, className }: { asset: MediaAssetDto; className?: string }) {
  const [failed, setFailed] = React.useState(false);
  const Icon = KIND_ICON[asset.kind];
  const shell = cn(
    "bg-muted/60 relative flex min-h-48 w-full items-center justify-center overflow-hidden rounded-lg border",
    className,
  );

  if (asset.kind === "image" && !failed) {
    return (
      <div className={shell}>
        {/* eslint-disable-next-line @next/next/no-img-element -- own immutable files */}
        <img
          src={asset.url}
          alt={asset.alt ?? asset.filename}
          decoding="async"
          onError={() => setFailed(true)}
          className="max-h-[50vh] w-full object-contain"
        />
        {asset.visibility === "PRIVATE" ? <PrivateBadge /> : null}
      </div>
    );
  }

  if (asset.kind === "video") {
    return (
      <div className={cn(shell, "bg-black")}>
        <video src={asset.url} controls preload="metadata" className="max-h-[50vh] w-full" aria-label={asset.alt ?? asset.filename} />
        {asset.visibility === "PRIVATE" ? <PrivateBadge /> : null}
      </div>
    );
  }

  return (
    <div className={cn(shell, "flex-col gap-3 py-10 text-center")}>
      <Icon className="text-muted-foreground size-10" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{fileExtension(asset.filename) || asset.kind}</p>
        <p className="text-muted-foreground text-xs">{asset.mimeType ?? "Unknown type"}</p>
      </div>
      <Button asChild variant="outline" size="sm">
        <a href={asset.url} target="_blank" rel="noopener noreferrer">
          <ExternalLink />
          Open file
        </a>
      </Button>
      {asset.visibility === "PRIVATE" ? <PrivateBadge /> : null}
    </div>
  );
}

function PrivateBadge() {
  return (
    <span className="bg-background/90 text-warning absolute top-2 left-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium">
      <Lock className="size-3" />
      Private - reads are audited
    </span>
  );
}
