/**
 * Asset URL resolution.
 *
 * MediaAsset.url stores the CANONICAL storefront path - "/products/bags/..." -
 * because that is exactly what the public read API must hand back after
 * cutover, and changing it would break the shape parity the whole migration
 * depends on.
 *
 * The admin cannot serve that path itself, so for its own previews it maps
 * legacy paths onto the copies under public/legacy/ made by
 * `npm run extract:storefront`.
 *
 * The filenames contain spaces and parentheses ("WhatsApp Image 2026-08-17 at
 * 5.37.34 PM (1).jpeg"), so every path is encoded on the way out. Renaming
 * them would be cleaner but would break the storefront, which references them
 * literally.
 */

export function isExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * encodeURI, made idempotent.
 *
 * The legacy data is not consistent: products.js carries literal spaces
 * ("WhatsApp Image 2026-08-17 at 5.37.34 PM.jpeg") while the hero slides in
 * homeData.js are already percent-encoded ("...WhatsApp%20Image%20..."). Running
 * encodeURI over the second kind escapes its own "%" and produces "%2520",
 * which 404s. Decoding first means both shapes land on the same output.
 */
function encodeOnce(path: string): string {
  try {
    return encodeURI(decodeURI(path));
  } catch {
    // A stray "%" that is not a valid escape sequence. Encode what we were
    // given rather than throwing inside a render.
    return encodeURI(path);
  }
}

/** Where the admin should load this asset from for display. */
export function resolveAssetUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (isExternalUrl(url)) return url;

  const normalized = url.startsWith("/") ? url : `/${url}`;

  // Legacy storefront assets were copied into public/legacy/ at extraction.
  const adminPath = normalized.startsWith("/products/")
    ? `/legacy${normalized}`
    : normalized;

  return encodeOnce(adminPath);
}

export function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /\.(mp4|webm|mov)(\?|$)/i.test(url) || url.includes("/video/");
}

export function filenameFromUrl(url: string): string {
  try {
    return decodeURIComponent(url.split("/").pop() ?? url).split("?")[0];
  } catch {
    return url;
  }
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
