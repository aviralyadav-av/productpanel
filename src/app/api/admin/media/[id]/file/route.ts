import { withAdminApi } from "@/lib/api/admin";
import { forbiddenError, notFound } from "@/lib/api/errors";
import { can } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { getStorage, kindForMime } from "@/lib/storage";

import { auditPrivateRead } from "@/features/media/service";

/**
 * GET /api/admin/media/:id/file   (blueprint §14.D6)
 *
 * The ONLY way a PRIVATE object leaves storage. Requires a signed-in admin
 * with `media.view`; when the asset is a seller's KYC document it also
 * requires `sellers.view` (permission "by usage"). Every read is audited as
 * `media.private_read` before the first byte streams.
 *
 * Headers: the stored MIME type with `nosniff`, `no-store` (never cache a
 * private document in a shared proxy), `inline` for images/video so the admin
 * can preview them, `attachment` for everything else so a PDF never renders
 * on our origin. Single byte ranges are honoured so <video> can seek.
 *
 * A PUBLIC asset requested here is simply redirected to its public URL.
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const asset = await db.mediaAsset.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        url: true,
        filename: true,
        kind: true,
        mimeType: true,
        sizeBytes: true,
        storageKey: true,
        storageProvider: true,
        visibility: true,
        _count: { select: { sellerDocuments: true } },
      },
    });
    if (!asset) throw notFound("Media asset");

    if (asset.visibility !== "PRIVATE") {
      return Response.redirect(new URL(asset.url, req.url), 302);
    }

    if (asset._count.sellerDocuments > 0 && !can(actor, "sellers.view")) {
      throw forbiddenError("Seller KYC documents require the sellers.view permission.");
    }

    if (!asset.storageKey || asset.storageProvider === "external") throw notFound("File");

    const storage = await getStorage();
    const info = await storage.stat(asset.storageKey, "PRIVATE");
    if (!info) throw notFound("File");

    const mimeType = asset.mimeType ?? "application/octet-stream";
    const kind = kindForMime(mimeType);

    const headers = new Headers({
      "Content-Type": mimeType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
      "Content-Disposition": `${kind === "image" || kind === "video" ? "inline" : "attachment"}; filename="${asciiFilename(asset.filename)}"`,
    });
    if (mimeType === "image/svg+xml") {
      headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    }

    await auditPrivateRead(asset, actor, { ip, userAgent: req.headers.get("user-agent") });

    const range = parseRange(req.headers.get("range"), info.size);
    if (range === "unsatisfiable") {
      headers.set("Content-Range", `bytes */${info.size}`);
      return new Response(null, { status: 416, headers });
    }

    if (range) {
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`);
      headers.set("Content-Length", String(range.end - range.start + 1));
      if (req.method === "HEAD") return new Response(null, { status: 206, headers });
      return new Response(await storage.readStream(asset.storageKey, "PRIVATE", range), { status: 206, headers });
    }

    headers.set("Content-Length", String(info.size));
    if (req.method === "HEAD") return new Response(null, { status: 200, headers });
    return new Response(await storage.readStream(asset.storageKey, "PRIVATE"), { status: 200, headers });
  },
  { permission: "media.view" },
);

export const HEAD = GET;

function asciiFilename(name: string): string {
  const cleaned = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_").slice(0, 120);
  return cleaned || "download";
}

function parseRange(header: string | null, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || size === 0) return null;
  const [, startRaw, endRaw] = match;
  if (startRaw === "" && endRaw === "") return null;

  let start: number;
  let end: number;
  if (startRaw === "") {
    start = Math.max(0, size - Number(endRaw));
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === "" ? size - 1 : Math.min(Number(endRaw), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return "unsatisfiable";
  return { start, end };
}
