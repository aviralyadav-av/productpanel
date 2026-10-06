import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

import { slugify, type SeedContext } from "./context";
import { categoryTileSvg, documentSvg, heroBannerSvg, logoSvg, putDemoSvg } from "../lib/placeholders";
import { demoId, loadCategories, registerMedia, state } from "../lib/state";

/**
 * Demo media (blueprint §12): media folders, generated category artwork,
 * private placeholders for customer uploads, and the legacy bag photographs
 * that already live under public/legacy (registered as `external` assets so
 * the media library knows about them without copying 12 MB into storage).
 *
 * Category image/icon/banner are attached only where the admin has not set
 * one - re-seeding never replaces a real upload with a placeholder.
 */

export const ROOT_HUES: Record<string, number> = {
  "home-living": 22,
  fashion: 335,
  jewellery: 42,
  gifts: 195,
  stationery: 150,
  paintings: 262,
};

export function hueForCategoryPath(categoryPath: string | null): number {
  const root = categoryPath?.split("/").filter(Boolean)[0] ?? "gifts";
  const base = ROOT_HUES[root] ?? 200;
  const leaf = categoryPath?.split("/").filter(Boolean).pop() ?? "";
  // Spread children around the root hue deterministically.
  let shift = 0;
  for (const char of leaf) shift = (shift + char.charCodeAt(0)) % 40;
  return base + shift - 20;
}

const FOLDERS: Array<{ path: string; name: string; parent: string | null }> = [
  { path: "demo", name: "Demo data", parent: null },
  { path: "demo/categories", name: "Categories", parent: "demo" },
  { path: "demo/products", name: "Products", parent: "demo" },
  { path: "demo/banners", name: "Banners", parent: "demo" },
  { path: "demo/sellers", name: "Sellers", parent: "demo" },
  { path: "demo/blog", name: "Blog", parent: "demo" },
  { path: "demo/documents", name: "Seller documents (private)", parent: "demo" },
  { path: "demo/uploads", name: "Customer uploads (private)", parent: "demo" },
  { path: "legacy", name: "Legacy photos", parent: null },
  { path: "legacy/bags", name: "Bags", parent: "legacy" },
];

const IMAGE_EXTENSIONS: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
};

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else files.push(full);
  }
  return files.sort();
}

async function imageDimensions(file: string, mimeType: string): Promise<{ width: number | null; height: number | null }> {
  if (!mimeType.startsWith("image/")) return { width: null, height: null };
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(file).metadata();
    return { width: meta.width ?? null, height: meta.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

export async function seedDemoMedia(db: PrismaClient, ctx: SeedContext): Promise<void> {
  await loadCategories(db);

  // ---- folders ----------------------------------------------------------------
  const folderId = new Map<string, string>();
  for (const folder of FOLDERS) {
    const row = await db.mediaFolder.upsert({
      where: { path: folder.path },
      update: {},
      create: {
        id: demoId("folder", folder.path.replace(/\//g, "-")),
        path: folder.path,
        name: folder.name,
        parentId: folder.parent ? folderId.get(folder.parent) ?? null : null,
      },
      select: { id: true },
    });
    folderId.set(folder.path, row.id);
    registerMedia(`folder:${folder.path}`, row.id, "");
  }

  // ---- category artwork -------------------------------------------------------
  let categoryAssets = 0;
  for (const category of state.categories.values()) {
    const hue = hueForCategoryPath(category.path);
    const eyebrow = category.depth === 0 ? "DIY Baazar" : state.categoryById.get(category.parentId ?? "")?.name ?? "DIY Baazar";
    const image = await putDemoSvg(db, {
      id: demoId("media_cat", category.slug),
      key: `demo/categories/${category.slug}.svg`,
      svg: categoryTileSvg({ name: category.name, hue, eyebrow }),
      folderId: folderId.get("demo/categories") ?? null,
      alt: `${category.name} - handmade products on DIY Baazar`,
      width: 800,
      height: 800,
      uploadedById: ctx.adminUserId,
    });
    registerMedia(`category:${category.slug}`, image.id, image.url);
    categoryAssets += 1;

    const data: { imageMediaId?: string; bannerMediaId?: string; iconMediaId?: string } = {};
    const current = await db.category.findUnique({
      where: { id: category.id },
      select: { imageMediaId: true, bannerMediaId: true, iconMediaId: true },
    });
    if (!current) continue;
    if (!current.imageMediaId) data.imageMediaId = image.id;

    if (category.depth === 0) {
      const banner = await putDemoSvg(db, {
        id: demoId("media_catbanner", category.slug),
        key: `demo/categories/${category.slug}-banner.svg`,
        svg: heroBannerSvg({
          heading: category.name,
          subheading: "Handmade by independent Indian artisans. Every piece one of a kind.",
          hue,
          buttonText: "Shop the collection",
          eyebrow: "Collection",
        }),
        folderId: folderId.get("demo/categories") ?? null,
        alt: `${category.name} collection banner`,
        width: 1600,
        height: 600,
        uploadedById: ctx.adminUserId,
      });
      registerMedia(`category-banner:${category.slug}`, banner.id, banner.url);
      const icon = await putDemoSvg(db, {
        id: demoId("media_caticon", category.slug),
        key: `demo/categories/${category.slug}-icon.svg`,
        svg: logoSvg({ initials: category.name.replace(/[^A-Za-z]/g, "").slice(0, 2), hue }),
        folderId: folderId.get("demo/categories") ?? null,
        alt: `${category.name} icon`,
        width: 400,
        height: 400,
        uploadedById: ctx.adminUserId,
      });
      registerMedia(`category-icon:${category.slug}`, icon.id, icon.url);
      categoryAssets += 2;
      if (!current.bannerMediaId) data.bannerMediaId = banner.id;
      if (!current.iconMediaId) data.iconMediaId = icon.id;
    }
    if (Object.keys(data).length > 0) {
      await db.category.update({ where: { id: category.id }, data });
    }
  }
  ctx.log(`category media: ${categoryAssets}`);

  // ---- private placeholders for customer customisation uploads ----------------
  for (let index = 1; index <= 3; index += 1) {
    const asset = await putDemoSvg(db, {
      id: demoId("media_upload", index),
      key: `demo/uploads/customer-photo-${index}.svg`,
      svg: documentSvg({
        title: `Customer photo upload ${index}`,
        lines: ["Uploaded at checkout for a personalised product.", "Private: visible to the admin and the seller only."],
      }),
      folderId: folderId.get("demo/uploads") ?? null,
      alt: `Customer upload ${index}`,
      width: 800,
      height: 1100,
      visibility: "PRIVATE",
      uploadedById: null,
    });
    registerMedia(`upload:${index}`, asset.id, asset.url);
  }

  // ---- legacy bag photos ------------------------------------------------------
  const legacyRoot = path.resolve(process.cwd(), "public", "legacy");
  let legacyCount = 0;
  let files: string[] = [];
  try {
    files = await listFiles(legacyRoot);
  } catch {
    ctx.log("legacy photos: public/legacy not found, skipped");
  }
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const mimeType = IMAGE_EXTENSIONS[ext];
    if (!mimeType) continue;
    const relative = path.relative(legacyRoot, file).split(path.sep);
    const url = `/legacy/${relative.map((segment) => encodeURIComponent(segment)).join("/")}`;
    const id = demoId("media_legacy", slugify(relative.join(" ")));
    const group = relative.length > 1 ? relative[relative.length - 2] : "legacy";
    const kind = mimeType.startsWith("video/") ? "video" : "image";

    const existing = await db.mediaAsset.findUnique({ where: { id }, select: { id: true, url: true } });
    if (!existing) {
      const bytes = await readFile(file);
      const { width, height } = await imageDimensions(file, mimeType);
      await db.mediaAsset.create({
        data: {
          id,
          url,
          storageKey: null,
          storageProvider: "external",
          visibility: "PUBLIC",
          filename: relative[relative.length - 1],
          kind,
          mimeType,
          width,
          height,
          sizeBytes: bytes.byteLength,
          checksum: createHash("sha256").update(bytes).digest("hex"),
          alt: `Handcrafted ${group === "legacy" ? "bag" : group.replace(/s$/, "")} - DIY Baazar`,
          folderId: folderId.get("legacy/bags") ?? null,
          uploadedById: ctx.adminUserId,
        },
      });
    }
    const list = state.legacyPhotos.get(group) ?? [];
    list.push({ id, url, kind });
    state.legacyPhotos.set(group, list);
    state.mediaUrl.set(id, url);
    legacyCount += 1;
  }
  ctx.log(`legacy photos registered: ${legacyCount}`);
}
