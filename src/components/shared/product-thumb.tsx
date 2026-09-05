import { ImageOff } from "lucide-react";
import { cn } from "cn";

import { resolveAssetUrl, isVideoUrl } from "@/lib/media";

/**
 * A plain <img>, not next/image, on purpose.
 *
 * These assets are legacy storefront files served from public/legacy/ with
 * spaces and parentheses in their names, plus a handful of external
 * Unsplash/Pexels URLs. next/image would need a remotePatterns entry for every
 * one of those hosts and would gain nothing at 32-64px in an admin table.
 * Uploads added through the media library will be served by the image
 * optimizer once a storage provider is wired in.
 */
export function ProductThumb({
  src,
  alt,
  size = 40,
  className,
}: {
  src: string | null | undefined;
  alt: string;
  size?: number;
  className?: string;
}) {
  const resolved = resolveAssetUrl(src);

  const shell = cn(
    "bg-muted text-muted-foreground/60 flex shrink-0 items-center justify-center overflow-hidden rounded border",
    className,
  );

  if (!resolved) {
    return (
      <div className={shell} style={{ width: size, height: size }}>
        <ImageOff className="size-3.5" />
      </div>
    );
  }

  if (isVideoUrl(src)) {
    return (
      <video
        src={resolved}
        muted
        playsInline
        preload="metadata"
        aria-label={alt}
        className={cn(shell, "object-cover")}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resolved}
      alt={alt}
      loading="lazy"
      decoding="async"
      width={size}
      height={size}
      className={cn(shell, "object-cover")}
      style={{ width: size, height: size }}
    />
  );
}
