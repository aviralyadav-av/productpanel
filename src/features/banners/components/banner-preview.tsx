"use client";

import { ImageOff } from "lucide-react";
import { cn } from "cn";

import { resolveAssetUrl } from "@/lib/media";

import { placementInfo } from "../placements";

/**
 * A faithful-enough rendering of one banner: image (or background colour),
 * title, subtitle and button, at the placement's aspect ratio. Used at
 * card size on the board and full size (desktop + mobile side by side) in the
 * editor, so the operator sees colour contrast and cropping before saving.
 */
export type BannerPreviewData = {
  title: string;
  subtitle: string | null;
  placement: string;
  imageUrl: string | null;
  mobileImageUrl: string | null;
  altText: string | null;
  buttonText: string | null;
  textColor: string | null;
  bgColor: string | null;
};

export function BannerPreview({
  banner,
  variant = "desktop",
  className,
  compact = false,
}: {
  banner: BannerPreviewData;
  variant?: "desktop" | "mobile";
  className?: string;
  /** Card size: image + a one-line title only. */
  compact?: boolean;
}) {
  const info = placementInfo(banner.placement);
  const aspect = variant === "mobile" ? 1 : info.aspect;
  const image = resolveAssetUrl(variant === "mobile" ? (banner.mobileImageUrl ?? banner.imageUrl) : banner.imageUrl);
  const textColor = banner.textColor ?? (image ? "#ffffff" : undefined);

  return (
    <div
      className={cn("bg-muted relative w-full overflow-hidden rounded-md border", className)}
      style={{ aspectRatio: String(aspect), backgroundColor: banner.bgColor ?? undefined }}
      aria-label={`${variant} preview`}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- preview of an arbitrary admin-uploaded asset; no need for next/image optimisation
        <img src={image} alt={banner.altText ?? ""} className="absolute inset-0 size-full object-cover" />
      ) : !banner.bgColor ? (
        <div className="text-muted-foreground absolute inset-0 flex items-center justify-center">
          <ImageOff className="size-5" />
        </div>
      ) : null}
      {image && !compact ? <div className="absolute inset-0 bg-gradient-to-r from-black/45 to-transparent" aria-hidden /> : null}
      {!compact ? (
        <div className={cn("absolute inset-0 flex flex-col justify-center gap-1", variant === "mobile" ? "p-4" : "p-6")} style={{ color: textColor }}>
          <p className={cn("font-semibold leading-tight", variant === "mobile" ? "text-base" : "text-xl")}>{banner.title || "Banner title"}</p>
          {banner.subtitle ? <p className={cn("max-w-prose opacity-90", variant === "mobile" ? "text-xs" : "text-sm")}>{banner.subtitle}</p> : null}
          {banner.buttonText ? (
            <span className="mt-2 inline-flex w-fit items-center rounded-md border border-current px-3 py-1 text-xs font-medium">{banner.buttonText}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
