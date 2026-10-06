import { FileText, Film, Image as ImageIcon, type LucideIcon } from "lucide-react";

import type { MediaKind } from "@/lib/enums";

/**
 * Small pure helpers shared by the library UI and the picker. Client-safe.
 */

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

export function formatDimensions(width: number | null | undefined, height: number | null | undefined): string {
  if (!width || !height) return "—";
  return `${width} × ${height}`;
}

export const KIND_ICON: Record<MediaKind, LucideIcon> = {
  image: ImageIcon,
  video: Film,
  document: FileText,
};

export const KIND_LABEL: Record<MediaKind, string> = {
  image: "Image",
  video: "Video",
  document: "Document",
};

/** What to draw in a tile: the thumbnail, the image itself (SVG/ICO have none), or an icon. */
export function previewSrc(asset: {
  kind: MediaKind;
  url: string;
  thumbnailUrl: string | null;
  visibility: "PUBLIC" | "PRIVATE";
  mimeType: string | null;
}): string | null {
  if (asset.kind !== "image") return null;
  if (asset.thumbnailUrl) return asset.thumbnailUrl;
  // PRIVATE images stream through the admin file route, which is fine for a preview.
  return asset.url;
}

export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1).toUpperCase() : "";
}
