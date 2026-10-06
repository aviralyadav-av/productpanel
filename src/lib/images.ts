import { createHash } from "node:crypto";

import sharp, { type Metadata } from "sharp";
import sanitize, { type IOptions } from "sanitize-html";

/**
 * Image processing for uploads (blueprint §11.20, §14.D6).
 *
 * Every raster image an operator uploads is decoded and re-encoded by sharp
 * before it touches storage. That single pass does four jobs at once: it
 * proves the bytes really are an image (a polyglot "PNG" with an HTML tail
 * fails to decode), strips EXIF/XMP/ICC and the GPS coordinates hiding in
 * them, applies the EXIF orientation so the stored pixels are upright, and
 * bounds the output to `maxDim` on the longest side. The decoder is capped
 * with `limitInputPixels` so a 30 000 x 30 000 decompression bomb is refused
 * before it allocates.
 *
 * SVG is text, not pixels, so it takes the other door: an allowlist
 * sanitiser that keeps drawing primitives and gradients and drops script,
 * foreignObject, event handlers and every external reference.
 *
 * No Next imports: the seed and the media check script call this as plain
 * tsx. sharp and sanitize-html are in `serverExternalPackages` (G6).
 */

export const THUMBNAIL_SIZE = 400;
export const DEFAULT_MAX_DIM = 5000;
export const DEFAULT_LIMIT_INPUT_PIXELS = 50e6;
/** PNG/JPEG larger than this are re-encoded as WebP (typically 30-60% smaller). */
export const WEBP_THRESHOLD_BYTES = 2 * 1024 * 1024;

export type Thumbnail = {
  buffer: Buffer;
  width: number;
  height: number;
  mimeType: "image/webp";
};

export type ProcessedImage = {
  buffer: Buffer;
  width: number;
  height: number;
  mimeType: string;
  ext: string;
  thumbnail: Thumbnail | null;
  /** sha256 hex of the OUTPUT bytes - what is actually stored. */
  checksum: string;
};

export type ProcessImageOptions = {
  maxDim?: number;
  limitInputPixels?: number;
  thumbnailSize?: number;
  /** Set false to skip the thumbnail (PRIVATE assets never get one). */
  thumbnail?: boolean;
};

/** Raised for anything the operator can act on: wrong type, too big, corrupt. */
export class ImageProcessingError extends Error {
  readonly code: "UNSUPPORTED_FORMAT" | "TOO_MANY_PIXELS" | "CORRUPT";
  constructor(code: ImageProcessingError["code"], message: string) {
    super(message);
    this.name = "ImageProcessingError";
    this.code = code;
  }
}

export function sha256(buffer: Buffer | Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** sharp's `format` names for the raster types the allowlist accepts. */
const RASTER_FORMATS: Record<string, { mimeType: string; ext: string }> = {
  jpeg: { mimeType: "image/jpeg", ext: "jpg" },
  png: { mimeType: "image/png", ext: "png" },
  webp: { mimeType: "image/webp", ext: "webp" },
  gif: { mimeType: "image/gif", ext: "gif" },
  avif: { mimeType: "image/avif", ext: "avif" },
  heif: { mimeType: "image/avif", ext: "avif" },
};

function isPixelLimitError(error: unknown): boolean {
  return error instanceof Error && /pixel limit|exceeds/i.test(error.message);
}

/**
 * Decode, normalise and re-encode a raster upload.
 *
 * Output format follows the input except where a different one is strictly
 * better for the storefront: PNG/JPEG above 2 MB become WebP (same visual
 * quality, far fewer bytes), AVIF becomes WebP (decoding AVIF is fine,
 * encoding it takes seconds per image and nothing downstream needs it), GIF
 * stays GIF with animation preserved.
 */
export async function processImageUpload(
  input: Buffer,
  options: ProcessImageOptions = {},
): Promise<ProcessedImage> {
  const maxDim = options.maxDim ?? DEFAULT_MAX_DIM;
  const limitInputPixels = options.limitInputPixels ?? DEFAULT_LIMIT_INPUT_PIXELS;
  const thumbnailSize = options.thumbnailSize ?? THUMBNAIL_SIZE;

  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels }).metadata();
  } catch (error) {
    if (isPixelLimitError(error)) {
      throw new ImageProcessingError("TOO_MANY_PIXELS", "This image has too many pixels to process.");
    }
    throw new ImageProcessingError("CORRUPT", "This file could not be decoded as an image.");
  }

  const format = meta.format ? RASTER_FORMATS[meta.format] : undefined;
  if (!format) {
    throw new ImageProcessingError(
      "UNSUPPORTED_FORMAT",
      `Unsupported image format "${meta.format ?? "unknown"}". Use JPEG, PNG, WebP, GIF, AVIF or SVG.`,
    );
  }

  const isGif = meta.format === "gif";
  const inputBytes = input.byteLength;

  // Decide the output encoding up front so the pipeline is one pass.
  let outMime = format.mimeType;
  let outExt = format.ext;
  if ((meta.format === "jpeg" || meta.format === "png") && inputBytes > WEBP_THRESHOLD_BYTES) {
    outMime = "image/webp";
    outExt = "webp";
  } else if (format.mimeType === "image/avif") {
    // sharp reports AVIF as "heif" (or "avif" in newer builds); either way, out as WebP.
    outMime = "image/webp";
    outExt = "webp";
  }

  try {
    // `animated` keeps every GIF frame; `.rotate()` with no argument applies
    // the EXIF orientation and drops the tag. Metadata is stripped by default
    // because we never call `.withMetadata()`.
    let pipeline = sharp(input, { limitInputPixels, animated: isGif })
      .rotate()
      .resize({ width: maxDim, height: maxDim, fit: "inside", withoutEnlargement: true });

    switch (outMime) {
      case "image/jpeg":
        pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });
        break;
      case "image/png":
        pipeline = pipeline.png({ compressionLevel: 9 });
        break;
      case "image/gif":
        pipeline = pipeline.gif();
        break;
      default:
        pipeline = pipeline.webp({ quality: 82 });
        break;
    }

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    // For animated output `info.height` is the whole page stack; pageHeight is one frame.
    const height = isGif && info.pageHeight ? info.pageHeight : info.height;

    const thumbnail =
      options.thumbnail === false ? null : await makeThumbnail(input, limitInputPixels, thumbnailSize);

    return {
      buffer: data,
      width: info.width,
      height,
      mimeType: outMime,
      ext: outExt,
      thumbnail,
      checksum: sha256(data),
    };
  } catch (error) {
    if (error instanceof ImageProcessingError) throw error;
    if (isPixelLimitError(error)) {
      throw new ImageProcessingError("TOO_MANY_PIXELS", "This image has too many pixels to process.");
    }
    throw new ImageProcessingError("CORRUPT", "This image could not be processed. It may be corrupt.");
  }
}

/** First frame only, longest side `size`, always WebP. */
async function makeThumbnail(input: Buffer, limitInputPixels: number, size: number): Promise<Thumbnail> {
  const { data, info } = await sharp(input, { limitInputPixels })
    .rotate()
    .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height, mimeType: "image/webp" };
}

/**
 * Rasterise a (sanitised) SVG for its library thumbnail. Best effort: an SVG
 * that librsvg cannot draw simply has no thumbnail and shows the kind icon.
 */
export async function rasterizeSvgThumbnail(
  svg: string,
  size = THUMBNAIL_SIZE,
  limitInputPixels = DEFAULT_LIMIT_INPUT_PIXELS,
): Promise<Thumbnail | null> {
  try {
    const { data, info } = await sharp(Buffer.from(svg, "utf8"), { limitInputPixels, density: 96 })
      .resize({ width: size, height: size, fit: "inside", withoutEnlargement: false })
      .webp({ quality: 78 })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height, mimeType: "image/webp" };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

const SVG_TAGS = [
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "use",
  "title",
  "desc",
];

/**
 * Presentation and geometry attributes only. Deliberately absent: `style`
 * (can carry url() loads and, in some renderers, expressions), every `on*`
 * handler, `xmlns:*` other than the two SVG needs, and anything that names an
 * external resource. `href`/`xlink:href` are kept but constrained to
 * same-document fragments below.
 */
const SVG_ATTRIBUTES = [
  "id",
  "class",
  "xmlns",
  "xmlns:xlink",
  "version",
  "viewBox",
  "preserveAspectRatio",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "d",
  "points",
  "dx",
  "dy",
  "rotate",
  "textLength",
  "lengthAdjust",
  "transform",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "offset",
  "stop-color",
  "stop-opacity",
  "clipPathUnits",
  "maskUnits",
  "maskContentUnits",
  "clip-path",
  "clip-rule",
  "mask",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "opacity",
  "color",
  "display",
  "visibility",
  "overflow",
  "paint-order",
  "vector-effect",
  "shape-rendering",
  "text-rendering",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-variant",
  "letter-spacing",
  "word-spacing",
  "text-anchor",
  "text-decoration",
  "dominant-baseline",
  "alignment-baseline",
  "baseline-shift",
  "href",
  "xlink:href",
  "role",
  "aria-label",
  "aria-hidden",
  "focusable",
];

const SVG_SANITIZE_OPTIONS: IOptions = {
  allowedTags: SVG_TAGS,
  allowedAttributes: { "*": SVG_ATTRIBUTES },
  allowedClasses: {},
  allowedStyles: {},
  // No scheme is ever acceptable on href: only "#fragment" survives the
  // value filter below. Listing none here makes sanitize-html drop anything
  // with a scheme before we even look at it.
  allowedSchemes: [],
  allowedSchemesByTag: {},
  allowedSchemesAppliedToAttributes: ["href", "xlink:href"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  enforceHtmlBoundary: false,
  // Drop the CONTENT of these too, not just the tags.
  nonTextTags: ["script", "style", "foreignObject", "foreignobject", "iframe", "object", "embed", "image", "animate", "set"],
  // SVG is case-sensitive: `linearGradient` and `viewBox` must survive intact.
  parser: { lowerCaseTags: false, lowerCaseAttributeNames: false, xmlMode: true },
  selfClosing: ["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "stop", "use"],
};

/** `url(#id)` is a same-document paint server; anything else is a fetch. */
const EXTERNAL_URL_FUNC = /url\(\s*['"]?\s*(?!#)/i;
const FORBIDDEN_IN_OUTPUT = [/<script/i, /<foreignObject/i, /\son[a-z]+\s*=/i, /javascript:/i, /data:/i, /<!ENTITY/i];

export type SanitizedSvg =
  | { ok: true; svg: string; width: number | null; height: number | null }
  | { ok: false; reason: string };

export function looksLikeSvg(text: string): boolean {
  const head = text.slice(0, 4096).replace(/^﻿/, "").trimStart();
  return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head);
}

/**
 * Allowlist-sanitise an SVG document. Returns `ok:false` when the input is not
 * an SVG, when no drawable root survives, or when the output still contains
 * something the post-filter refuses to store - in which case the file is
 * rejected outright rather than "cleaned", because an operator who uploaded a
 * scripted SVG should be told, not silently given a different file.
 */
export function sanitizeSvg(text: string): SanitizedSvg {
  if (!looksLikeSvg(text)) return { ok: false, reason: "The file is not an SVG document." };
  if (/<!ENTITY/i.test(text)) return { ok: false, reason: "SVGs with custom XML entities are not accepted." };

  let svg = sanitize(text, SVG_SANITIZE_OPTIONS).trim();

  // Drop attribute values that reference anything outside the document.
  svg = svg.replace(/\s([a-zA-Z:-]+)=("[^"]*"|'[^']*')/g, (match, name: string, quoted: string) => {
    const value = quoted.slice(1, -1);
    if (name === "href" || name === "xlink:href") {
      return value.startsWith("#") ? match : "";
    }
    if (EXTERNAL_URL_FUNC.test(value)) return "";
    if (/javascript:|data:|expression\(/i.test(value)) return "";
    return match;
  });

  if (!/^<svg[\s>]/i.test(svg)) return { ok: false, reason: "The SVG has no <svg> root element." };
  if (FORBIDDEN_IN_OUTPUT.some((pattern) => pattern.test(svg))) {
    return { ok: false, reason: "The SVG contains script or external references and was rejected." };
  }

  // Make sure the root declares the namespace, or browsers render nothing.
  if (!/^<svg[^>]*\sxmlns=/i.test(svg)) {
    svg = svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  const { width, height } = svgDimensions(svg);
  return { ok: true, svg, width, height };
}

/**
 * Intrinsic size from the root element: viewBox first (the geometry the
 * drawing was authored in), else width/height when they are plain numbers or
 * px. Percentages and em have no pixel meaning, so they yield null.
 */
export function svgDimensions(svg: string): { width: number | null; height: number | null } {
  const root = svg.match(/<svg\b([^>]*)>/i)?.[1] ?? "";

  const viewBox = root.match(/\bviewBox\s*=\s*["']\s*([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)\s*["']/i);
  if (viewBox) {
    const width = Math.round(Number(viewBox[3]));
    const height = Math.round(Number(viewBox[4]));
    if (width > 0 && height > 0) return { width, height };
  }

  const read = (name: string): number | null => {
    const match = root.match(new RegExp(`\\b${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, "i"));
    if (!match) return null;
    const value = Math.round(Number(match[1]));
    return value > 0 ? value : null;
  };

  return { width: read("width"), height: read("height") };
}

// ---------------------------------------------------------------------------
// ICO (sharp cannot decode it; we store it as-is after a header check)
// ---------------------------------------------------------------------------

/** Size of the first (usually largest) image in an ICONDIR; 0 in the header means 256. */
export function icoDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 22) return null;
  if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) return null;
  const count = buffer.readUInt16LE(4);
  if (count === 0) return null;
  const width = buffer[6] === 0 ? 256 : buffer[6];
  const height = buffer[7] === 0 ? 256 : buffer[7];
  return { width, height };
}
