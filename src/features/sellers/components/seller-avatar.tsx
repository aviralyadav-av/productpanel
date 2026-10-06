import { cn } from "cn";

import { resolveAssetUrl } from "@/lib/media";

/**
 * Seller logo with initials as the fallback. Logos are PUBLIC media, so the
 * stored URL is used directly; a seller without a logo still gets a stable,
 * recognisable mark in lists. Server-compatible plain markup.
 */
export function SellerAvatar({
  name,
  src,
  size = 32,
  className,
}: {
  name: string;
  src: string | null;
  size?: number;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter((word) => /^[A-Za-z0-9]/.test(word))
    .map((word) => word[0]!.toUpperCase())
    .join("")
    .slice(0, 2);
  const resolved = resolveAssetUrl(src);

  return (
    <span
      className={cn("bg-muted text-muted-foreground flex shrink-0 items-center justify-center overflow-hidden rounded-md border", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {resolved ? (
        // eslint-disable-next-line @next/next/no-img-element -- media URLs come from our own storage or S3
        <img src={resolved} alt="" className="size-full object-cover" />
      ) : (
        <span className="text-[10px] font-semibold" style={{ fontSize: Math.max(9, Math.round(size * 0.32)) }}>
          {initials || "?"}
        </span>
      )}
    </span>
  );
}
