import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

import { getStorage, type StorageVisibility } from "@/lib/storage";

/**
 * Placeholder artwork for the demo dataset (blueprint §12).
 *
 * Every demo image is an SVG generated here and written through the storage
 * adapter exactly like an admin upload would be (getStorage().put, PUBLIC),
 * then registered as a MediaAsset so the media library, the picker and the
 * usage counts all see it. SVG keeps the seed dependency-free and the files
 * tiny; the compositions are deliberately designed (gradients, pattern, type
 * hierarchy) so the admin screens look like a real store, not lorem ipsum.
 *
 * Keys are stable (`demo/products/demo_prod_001-1.svg`), so a re-run
 * overwrites the same file and upserts the same row.
 */

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Segoe UI', Helvetica, Arial, sans-serif";

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Greedy word wrap; long words are hard-split so nothing overflows the box. */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word.length > maxChars ? `${word.slice(0, maxChars - 1)}…` : word;
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length > maxLines) lines.length = maxLines;
  if (words.join(" ").length > lines.join(" ").length && lines.length === maxLines) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.length >= maxChars - 1 ? `${last.slice(0, maxChars - 2)}…` : `${last}…`;
  }
  return lines;
}

export function hsl(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360;
  return `hsl(${h.toFixed(0)} ${saturation}% ${lightness}%)`;
}

function pattern(id: string, hue: number, size: number, opacity = 0.09): string {
  return `<pattern id="${id}" width="${size}" height="${size}" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
    <circle cx="${size / 2}" cy="${size / 2}" r="${size / 7}" fill="${hsl(hue + 40, 80, 92)}" opacity="${opacity}"/>
    <circle cx="0" cy="0" r="${size / 14}" fill="${hsl(hue - 30, 80, 95)}" opacity="${opacity}"/>
  </pattern>`;
}

function gradient(id: string, hue: number, from: [number, number], to: [number, number], angle = 135): string {
  const rad = (angle * Math.PI) / 180;
  const x2 = 50 + 50 * Math.cos(rad);
  const y2 = 50 + 50 * Math.sin(rad);
  return `<linearGradient id="${id}" x1="${(100 - x2).toFixed(1)}%" y1="${(100 - y2).toFixed(1)}%" x2="${x2.toFixed(1)}%" y2="${y2.toFixed(1)}%">
    <stop offset="0%" stop-color="${hsl(hue, from[0], from[1])}"/>
    <stop offset="100%" stop-color="${hsl(hue + 24, to[0], to[1])}"/>
  </linearGradient>`;
}

function textLines(lines: string[], x: number, y: number, lineHeight: number, attrs: string): string {
  return lines
    .map((line, index) => `<text x="${x}" y="${y + index * lineHeight}" ${attrs}>${escapeXml(line)}</text>`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Compositions
// ---------------------------------------------------------------------------

/** 800×800 category tile: name on a soft card over a patterned gradient. */
export function categoryTileSvg(input: { name: string; hue: number; eyebrow?: string }): string {
  const lines = wrapText(input.name, 14, 2);
  const startY = lines.length === 1 ? 420 : 380;
  const ruleY = startY + (lines.length - 1) * 74 + 46;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800" role="img" aria-label="${escapeXml(input.name)}">
  <defs>${gradient("bg", input.hue, [58, 46], [62, 30])}${pattern("dots", input.hue, 72)}</defs>
  <rect width="800" height="800" fill="url(#bg)"/>
  <rect width="800" height="800" fill="url(#dots)"/>
  <circle cx="640" cy="160" r="220" fill="${hsl(input.hue + 30, 70, 75)}" opacity="0.22"/>
  <circle cx="150" cy="690" r="170" fill="${hsl(input.hue - 20, 70, 20)}" opacity="0.25"/>
  <rect x="80" y="240" width="640" height="320" rx="28" fill="${hsl(input.hue, 30, 97)}" opacity="0.94"/>
  <text x="400" y="300" text-anchor="middle" font-family="${SANS}" font-size="20" letter-spacing="6" fill="${hsl(input.hue, 40, 40)}">${escapeXml((input.eyebrow ?? "DIY BAAZAR").toUpperCase())}</text>
  ${textLines(lines, 400, startY, 74, `text-anchor="middle" font-family="${SERIF}" font-size="64" font-weight="600" fill="${hsl(input.hue, 45, 22)}"`)}
  <line x1="330" y1="${ruleY}" x2="470" y2="${ruleY}" stroke="${hsl(input.hue, 55, 50)}" stroke-width="4" stroke-linecap="round"/>
</svg>`;
}

/**
 * 1000×1000 product image: an abstract "object" in the product's colour, a
 * swatch band of the variant colours, and the title on a dark caption band.
 * `variant` shifts the composition so a product's 2nd/3rd image differ.
 */
export function productImageSvg(input: {
  title: string;
  subtitle: string;
  hue: number;
  colorHexes: string[];
  variant: number;
}): string {
  const lines = wrapText(input.title, 24, 2);
  const swatches = input.colorHexes.length > 0 ? input.colorHexes.slice(0, 6) : [hsl(input.hue, 60, 50)];
  const swatchWidth = 1000 / swatches.length;
  const v = input.variant % 3;
  const highlight = hsl(input.hue, 40, 96);
  const shape =
    v === 0
      ? `<circle cx="500" cy="420" r="230" fill="${swatches[0]}" opacity="0.92"/>
  <circle cx="440" cy="360" r="70" fill="${highlight}" opacity="0.45"/>`
      : v === 1
        ? `<rect x="270" y="200" width="460" height="460" rx="60" fill="${swatches[0]}" opacity="0.92" transform="rotate(8 500 430)"/>
  <rect x="330" y="260" width="120" height="120" rx="24" fill="${highlight}" opacity="0.4" transform="rotate(8 500 430)"/>`
        : `<path d="M500 180 C 690 180, 780 340, 720 480 C 670 600, 520 700, 400 660 C 260 610, 220 420, 300 300 C 350 220, 420 180, 500 180 Z" fill="${swatches[0]}" opacity="0.92"/>
  <ellipse cx="430" cy="330" rx="80" ry="46" fill="${highlight}" opacity="0.4"/>`;
  const band = swatches
    .map(
      (hex, index) =>
        `<rect x="${(index * swatchWidth).toFixed(1)}" y="782" width="${swatchWidth.toFixed(1)}" height="26" fill="${hex}"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000" role="img" aria-label="${escapeXml(input.title)}">
  <defs>${gradient("bg", input.hue + v * 10, [45, 92], [50, 82], 160 + v * 30)}${pattern("dots", input.hue, 60, 0.5)}
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="28"/></filter>
  </defs>
  <rect width="1000" height="1000" fill="url(#bg)"/>
  <rect width="1000" height="1000" fill="url(#dots)" opacity="0.5"/>
  <ellipse cx="500" cy="700" rx="290" ry="60" fill="${hsl(input.hue, 40, 30)}" opacity="0.18" filter="url(#soft)"/>
  ${shape}
  <g>${band}</g>
  <rect x="0" y="808" width="1000" height="192" fill="${hsl(input.hue, 35, 16)}"/>
  <text x="60" y="856" font-family="${SANS}" font-size="20" letter-spacing="5" fill="${hsl(input.hue, 40, 78)}">${escapeXml(input.subtitle.toUpperCase())}</text>
  ${textLines(lines, 60, 912, 50, `font-family="${SERIF}" font-size="44" font-weight="600" fill="${hsl(input.hue, 30, 97)}"`)}
</svg>`;
}

/** 1600×600 hero / promo banner with heading, sub-heading and a button pill. */
export function heroBannerSvg(input: {
  heading: string;
  subheading: string;
  hue: number;
  buttonText?: string;
  eyebrow?: string;
}): string {
  const lines = wrapText(input.heading, 26, 2);
  const subLines = wrapText(input.subheading, 60, 2);
  const headingY = lines.length === 1 ? 300 : 250;
  const subY = headingY + (lines.length - 1) * 86 + 70;
  const buttonY = subY + (subLines.length - 1) * 38 + 50;
  const buttonWidth = input.buttonText ? Math.max(180, input.buttonText.length * 16 + 60) : 0;
  const button = input.buttonText
    ? `<rect x="110" y="${buttonY - 34}" width="${buttonWidth}" height="58" rx="29" fill="${hsl(input.hue, 30, 97)}"/>
  <text x="${110 + buttonWidth / 2}" y="${buttonY + 4}" text-anchor="middle" font-family="${SANS}" font-size="22" font-weight="600" fill="${hsl(input.hue, 55, 28)}">${escapeXml(input.buttonText)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600" viewBox="0 0 1600 600" role="img" aria-label="${escapeXml(input.heading)}">
  <defs>${gradient("bg", input.hue, [55, 40], [60, 24], 20)}${pattern("dots", input.hue, 90)}</defs>
  <rect width="1600" height="600" fill="url(#bg)"/>
  <rect width="1600" height="600" fill="url(#dots)"/>
  <circle cx="1280" cy="300" r="260" fill="${hsl(input.hue + 35, 75, 70)}" opacity="0.28"/>
  <circle cx="1400" cy="150" r="130" fill="${hsl(input.hue - 25, 70, 85)}" opacity="0.28"/>
  <circle cx="1180" cy="470" r="90" fill="${hsl(input.hue + 60, 70, 60)}" opacity="0.35"/>
  <text x="110" y="170" font-family="${SANS}" font-size="22" letter-spacing="7" fill="${hsl(input.hue, 40, 88)}">${escapeXml((input.eyebrow ?? "DIY BAAZAR").toUpperCase())}</text>
  ${textLines(lines, 110, headingY, 86, `font-family="${SERIF}" font-size="76" font-weight="600" fill="${hsl(input.hue, 30, 98)}"`)}
  ${textLines(subLines, 110, subY, 38, `font-family="${SANS}" font-size="28" fill="${hsl(input.hue, 35, 92)}"`)}
  ${button}
</svg>`;
}

/** 400×400 seller logo: initials in a ring. */
export function logoSvg(input: { initials: string; hue: number }): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400" role="img" aria-label="${escapeXml(input.initials)}">
  <defs>${gradient("bg", input.hue, [55, 42], [60, 28])}</defs>
  <rect width="400" height="400" rx="80" fill="url(#bg)"/>
  <circle cx="200" cy="200" r="132" fill="none" stroke="${hsl(input.hue, 40, 92)}" stroke-width="6" opacity="0.7"/>
  <circle cx="200" cy="200" r="112" fill="${hsl(input.hue, 30, 97)}"/>
  <text x="200" y="232" text-anchor="middle" font-family="${SERIF}" font-size="92" font-weight="700" fill="${hsl(input.hue, 50, 26)}">${escapeXml(input.initials.slice(0, 2).toUpperCase())}</text>
</svg>`;
}

/** 800×1100 private "document" placeholder for seller KYC files and customer uploads. */
export function documentSvg(input: { title: string; lines: string[] }): string {
  const body = input.lines
    .map((line, index) => `<text x="80" y="${260 + index * 48}" font-family="${SANS}" font-size="26" fill="#2f3e46">${escapeXml(line)}</text>`)
    .join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1100" viewBox="0 0 800 1100" role="img" aria-label="${escapeXml(input.title)}">
  <rect width="800" height="1100" fill="#f7f4ee"/>
  <rect x="40" y="40" width="720" height="1020" fill="#ffffff" stroke="#d9d2c5" stroke-width="2"/>
  <rect x="40" y="40" width="720" height="110" fill="#2f3e46"/>
  <text x="80" y="108" font-family="${SANS}" font-size="34" font-weight="700" fill="#ffffff">${escapeXml(input.title)}</text>
  <text x="80" y="200" font-family="${SANS}" font-size="18" letter-spacing="4" fill="#8a8378">DEMO DOCUMENT · NOT A REAL RECORD</text>
  ${body}
  <rect x="80" y="880" width="640" height="120" rx="12" fill="#eef1f3"/>
  <text x="400" y="950" text-anchor="middle" font-family="${SERIF}" font-size="26" fill="#5b6b73">Specimen — generated by the demo seed</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// Writing assets
// ---------------------------------------------------------------------------

export type DemoAssetInput = {
  /** Stable MediaAsset id, e.g. demo_media_prod_001_1. */
  id: string;
  /** Storage key, e.g. demo/products/demo_prod_001-1.svg. */
  key: string;
  svg: string;
  folderId: string | null;
  alt: string;
  width: number;
  height: number;
  visibility?: StorageVisibility;
  uploadedById: string | null;
};

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Write the SVG through the storage adapter and upsert its MediaAsset row.
 * Skips the disk write when both the row and the file already exist, so a
 * second run is a handful of stat calls. PRIVATE assets get the admin file
 * URL as their `url` (the adapter returns none), matching how the media
 * module serves them.
 */
export async function putDemoSvg(db: Db, input: DemoAssetInput): Promise<{ id: string; url: string }> {
  const visibility = input.visibility ?? "PUBLIC";
  const storage = await getStorage();
  const existing = await db.mediaAsset.findUnique({ where: { id: input.id }, select: { id: true, url: true } });
  if (existing && (await storage.exists(input.key, visibility))) return existing;

  const body = Buffer.from(input.svg, "utf8");
  const result = await storage.put({ key: input.key, body, contentType: "image/svg+xml", visibility });
  const url = result.url ?? `/api/admin/media/${input.id}/file`;
  const checksum = createHash("sha256").update(body).digest("hex");
  const filename = input.key.split("/").pop() ?? `${input.id}.svg`;

  await db.mediaAsset.upsert({
    where: { id: input.id },
    update: { storageKey: input.key, sizeBytes: body.byteLength, checksum, url },
    create: {
      id: input.id,
      url,
      storageKey: input.key,
      storageProvider: storage.driver,
      visibility,
      filename,
      kind: "image",
      mimeType: "image/svg+xml",
      width: input.width,
      height: input.height,
      sizeBytes: body.byteLength,
      checksum,
      alt: input.alt,
      folderId: input.folderId,
      uploadedById: input.uploadedById,
    },
  });
  return { id: input.id, url };
}
