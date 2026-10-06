import type { NextRequest } from "next/server";

import { db } from "@/lib/db";
import {
  IMMUTABLE_CACHE_CONTROL,
  extensionOf,
  getStorage,
  isSafeStorageKey,
  kindForMime,
  mimeFromExtension,
} from "@/lib/storage";

/**
 * Serves PUBLIC objects from the local storage driver (blueprint §14.D6).
 *
 * Why a route handler and not `public/`: the framework would serve anything
 * dropped there with a sniffed Content-Type and no visibility check. Here the
 * type comes from the MediaAsset row (falling back to a closed extension
 * allowlist), `nosniff` pins it, and non-media kinds download instead of
 * rendering - so a PDF or an SVG uploaded by a seller can never run as a page
 * on our origin.
 *
 * The proxy must exempt `/media/*` from the admin auth check: storefront
 * visitors are anonymous.
 */

export const dynamic = "force-dynamic";

const NOT_FOUND_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: NOT_FOUND_HEADERS });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const { key: segments } = await ctx.params;
  const key = (segments ?? []).map((segment) => safeDecode(segment)).join("/");
  if (!isSafeStorageKey(key)) return notFound();

  const storage = await getStorage();

  // On S3 the object has its own public URL; keep old /media links working.
  if (storage.driver === "s3") {
    return Response.redirect(storage.publicUrl(key), 302);
  }

  const asset = await db.mediaAsset.findFirst({
    where: { storageKey: key },
    select: { mimeType: true, visibility: true, filename: true, kind: true },
  });
  if (asset && asset.visibility !== "PUBLIC") return notFound();

  const mimeType = asset?.mimeType ?? mimeFromExtension(extensionOf(key));
  if (!mimeType) return notFound();

  const info = await storage.stat(key, "PUBLIC");
  if (!info) return notFound();

  const kind = kindForMime(mimeType);
  const headers = new Headers({
    "Content-Type": mimeType,
    "Cache-Control": IMMUTABLE_CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  });
  if (kind === "image" || kind === "video") {
    headers.set("Content-Disposition", "inline");
  } else {
    headers.set(
      "Content-Disposition",
      `attachment; filename="${asciiFilename(asset?.filename ?? key.split("/").pop() ?? "download")}"`,
    );
  }
  // SVG can carry script; a CSP that forbids it makes the file inert even if
  // someone opens it top-level.
  if (mimeType === "image/svg+xml") {
    headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
  }

  // Single byte-range support so <video> seeks work without downloading all.
  const range = parseRange(req.headers.get("range"), info.size);
  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${info.size}`);
    return new Response(null, { status: 416, headers });
  }

  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    const stream = await storage.readStream(key, "PUBLIC", range);
    return new Response(stream, { status: 206, headers });
  }

  headers.set("Content-Length", String(info.size));
  if (req.method === "HEAD") return new Response(null, { status: 200, headers });
  const stream = await storage.readStream(key, "PUBLIC");
  return new Response(stream, { status: 200, headers });
}

export async function HEAD(req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  return GET(req, ctx);
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return "\0"; // fails isSafeStorageKey
  }
}

function asciiFilename(name: string): string {
  const cleaned = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_").slice(0, 120);
  return cleaned || "download";
}

function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || size === 0) return null;
  const [, startRaw, endRaw] = match;
  if (startRaw === "" && endRaw === "") return null;

  let start: number;
  let end: number;
  if (startRaw === "") {
    // Suffix range: last N bytes.
    const suffix = Number(endRaw);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === "" ? size - 1 : Math.min(Number(endRaw), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return "unsatisfiable";
  }
  return { start, end };
}
