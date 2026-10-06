/**
 * The closed list of file types this platform stores (blueprint §14.D6).
 *
 * A short allowlist rather than a general MIME database: anything we do not
 * recognise is refused at upload AND at serve time, so a stray `.html` or
 * `.svg` that somehow lands in the public directory is still never served
 * with a type a browser would execute.
 */

export type MediaKind = "image" | "video" | "document";

type MimeEntry = { mime: string; kind: MediaKind; ext: string };

const ENTRIES: readonly MimeEntry[] = [
  { mime: "image/jpeg", kind: "image", ext: "jpg" },
  { mime: "image/png", kind: "image", ext: "png" },
  { mime: "image/webp", kind: "image", ext: "webp" },
  { mime: "image/gif", kind: "image", ext: "gif" },
  { mime: "image/avif", kind: "image", ext: "avif" },
  // Admin-only after sanitisation (D6); served as image, never inline HTML.
  { mime: "image/svg+xml", kind: "image", ext: "svg" },
  { mime: "image/x-icon", kind: "image", ext: "ico" },
  { mime: "video/mp4", kind: "video", ext: "mp4" },
  { mime: "video/webm", kind: "video", ext: "webm" },
  { mime: "application/pdf", kind: "document", ext: "pdf" },
];

const BY_MIME = new Map(ENTRIES.map((entry) => [entry.mime, entry]));
const BY_EXT = new Map<string, MimeEntry>();
for (const entry of ENTRIES) BY_EXT.set(entry.ext, entry);
BY_EXT.set("jpeg", BY_MIME.get("image/jpeg")!);

export const ALLOWED_MIME_TYPES: readonly string[] = ENTRIES.map((entry) => entry.mime);

export function isAllowedMime(mime: string | null | undefined): boolean {
  return !!mime && BY_MIME.has(mime.toLowerCase());
}

export function mimeFromExtension(ext: string | null | undefined): string | null {
  if (!ext) return null;
  return BY_EXT.get(ext.toLowerCase().replace(/^\./, ""))?.mime ?? null;
}

export function extensionForMime(mime: string | null | undefined): string | null {
  if (!mime) return null;
  return BY_MIME.get(mime.toLowerCase())?.ext ?? null;
}

export function kindForMime(mime: string | null | undefined): MediaKind {
  if (!mime) return "document";
  const entry = BY_MIME.get(mime.toLowerCase());
  if (entry) return entry.kind;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

/** File extension of a key or filename, lowercased, without the dot. */
export function extensionOf(pathOrName: string): string | null {
  const base = pathOrName.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Magic-byte sniffing for the upload path (D6): the declared Content-Type of
 * an upload is attacker-controlled; the first bytes are not.
 */
export function sniffMime(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "image/webp";
  if (ascii(b, 4, 8) === "ftyp") {
    const brand = ascii(b, 8, 12);
    if (brand.startsWith("avif") || brand.startsWith("avis")) return "image/avif";
    return "video/mp4";
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  if (ascii(b, 0, 5) === "%PDF-") return "application/pdf";
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return "image/x-icon";
  return null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}
