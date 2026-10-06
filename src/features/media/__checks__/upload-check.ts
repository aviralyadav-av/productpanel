import "dotenv/config";

import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { db } from "@/lib/db";
import { sanitizeSvg } from "@/lib/images";
import { getStorage } from "@/lib/storage";

import { sanitizeFilename } from "@/features/media/schemas";
import {
  createFolder,
  deleteFolder,
  deleteMedia,
  detectMimeType,
  replaceMedia,
  updateMedia,
  uploadMedia,
} from "@/features/media/service";
import { USAGE_RELATIONS, getMediaUsage } from "@/features/media/usage";

/**
 * End-to-end check against the REAL database and the local storage driver:
 *
 *   npx tsx src/features/media/__checks__/upload-check.ts
 *
 * Generates a 120x80 PNG with sharp, uploads it through `uploadMedia`,
 * asserts the row, the original and the thumbnail exist, exercises update /
 * replace / usage / folder paths, then deletes everything and asserts the
 * files are gone. Also asserts the usage enumeration covers every
 * MediaAsset back-relation Prisma knows about, so a new `*MediaId` column
 * cannot silently escape the "in use" check.
 */

const STORAGE_ROOT = path.resolve(process.cwd(), process.env.STORAGE_LOCAL_DIR ?? "storage");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

function localPath(key: string, visibility: "PUBLIC" | "PRIVATE"): string {
  return path.join(STORAGE_ROOT, visibility.toLowerCase(), ...key.split("/"));
}

async function main(): Promise<void> {
  const storage = await getStorage();
  assert(storage.driver === "local", `expected local storage driver, got ${storage.driver}`);

  // 1. Schema coverage: every MediaAsset list-relation in prisma/schema.prisma
  //    must be in USAGE_RELATIONS. Read from the schema text (Prisma 7's runtime
  //    DMMF no longer carries relation fields).
  const schema = readFileSync(path.resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
  const modelBlock = schema.match(/\nmodel MediaAsset \{([\s\S]*?)\n\}/)?.[1];
  assert(modelBlock, "MediaAsset model in schema.prisma");
  const backRelations = [...modelBlock.matchAll(/^\s*(\w+)\s+\w+\[\]\s+@relation\(/gm)].map((m) => m[1]);
  assert(backRelations.length > 0, "found back-relations on MediaAsset");
  const missing = backRelations.filter((name) => !(USAGE_RELATIONS as readonly string[]).includes(name));
  assert(missing.length === 0, `usage.ts is missing relations: ${missing.join(", ")}`);
  console.log(`[ok] usage enumeration covers ${backRelations.length} back-relations: ${backRelations.join(", ")}`);

  // 2. Actor: any real user (uploadedById is a FK).
  const user = await db.user.findFirst({ where: { id: { not: "system" } }, select: { id: true, email: true } });
  assert(user, "at least one User row to act as");
  const actor = { id: user.id, email: user.email };

  // 3. Pure helpers.
  assert(sanitizeFilename("../../evil name.PNG.exe", "image/png") === "evil name.PNG.png", "filename sanitiser");
  assert(sanitizeFilename("photo.jpeg", "image/jpeg") === "photo.jpeg", "jpeg extension kept");
  const badSvg = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="5" height="5" onclick="x()"/></svg>');
  assert(badSvg.ok && !badSvg.svg.includes("script") && !badSvg.svg.includes("onclick"), "svg sanitiser strips script/on*");
  assert(badSvg.ok && badSvg.width === 10 && badSvg.height === 10, "svg viewBox dimensions");
  console.log("[ok] sanitizeFilename / sanitizeSvg");

  // 4. Generate a 120x80 PNG.
  const png = await sharp({ create: { width: 120, height: 80, channels: 3, background: { r: 200, g: 40, b: 60 } } })
    .png()
    .toBuffer();
  assert(detectMimeType(png) === "image/png", "magic bytes detect PNG");

  // 5. A scratch folder so the key prefix and the folder paths are exercised.
  const folder = await createFolder({ name: `Upload check ${Date.now()}`, parentId: null }, actor);
  console.log(`[ok] createFolder -> ${folder.path}`);

  let assetId: string | null = null;
  try {
    // 6. Upload.
    const asset = await uploadMedia({
      file: { buffer: png, filename: "Check Image.PNG", mimeType: "image/png" },
      folderId: folder.id,
      visibility: "PUBLIC",
      alt: "Generated check image",
      actor,
    });
    assetId = asset.id;

    assert(asset.kind === "image", "kind image");
    assert(asset.mimeType === "image/png", `mime png (got ${asset.mimeType})`);
    assert(asset.width === 120 && asset.height === 80, `dimensions 120x80 (got ${asset.width}x${asset.height})`);
    assert(asset.filename === "Check Image.png", `filename kept, extension lowercased (got ${asset.filename})`);
    assert(asset.storageKey && asset.storageKey.startsWith(`${folder.path}/`), `key under folder path (got ${asset.storageKey})`);
    assert(asset.url === `/media/${asset.storageKey}`, `public url (got ${asset.url})`);
    assert(asset.thumbnailUrl === `/media/${asset.storageKey}.thumb.webp`, `thumbnail url (got ${asset.thumbnailUrl})`);
    assert(asset.checksum && asset.checksum.length === 64, "sha256 checksum");
    assert(asset.folderId === folder.id, "folderId");
    assert(asset.uploadedById === actor.id, "uploadedById");

    const row = await db.mediaAsset.findUnique({ where: { id: asset.id } });
    assert(row, "row exists");

    const originalPath = localPath(asset.storageKey!, "PUBLIC");
    const thumbPath = localPath(`${asset.storageKey}.thumb.webp`, "PUBLIC");
    assert(existsSync(originalPath), `original on disk at ${originalPath}`);
    assert(existsSync(thumbPath), `thumbnail on disk at ${thumbPath}`);
    const thumbMeta = await sharp(readFileSync(thumbPath)).metadata();
    assert(thumbMeta.format === "webp" && thumbMeta.width === 120, `thumbnail is webp, not enlarged (got ${thumbMeta.format} ${thumbMeta.width})`);
    const storedMeta = await sharp(readFileSync(originalPath)).metadata();
    assert(storedMeta.format === "png" && storedMeta.width === 120 && storedMeta.height === 80, "stored original re-encoded as 120x80 png");
    console.log(`[ok] uploadMedia -> ${asset.id} ${asset.storageKey} (${asset.sizeBytes} bytes) + thumbnail`);

    const audit = await db.auditLog.findFirst({ where: { action: "media.upload", entityId: asset.id } });
    assert(audit, "media.upload audit row");
    console.log("[ok] audit row media.upload");

    // 7. Usage: none yet.
    const usages = await getMediaUsage(asset.id);
    assert(usages.length === 0, "fresh asset has no usages");

    // 8. Update metadata.
    const updated = await updateMedia(asset.id, { alt: "New alt", filename: "renamed.jpg" }, actor);
    assert(updated.alt === "New alt", "alt updated");
    assert(updated.filename === "renamed.png", `wrong extension replaced by the real one (got ${updated.filename})`);
    console.log("[ok] updateMedia");

    // 9. Replace with a JPEG (same kind) - new key, old files removed.
    const jpeg = await sharp({ create: { width: 64, height: 32, channels: 3, background: { r: 10, g: 120, b: 200 } } })
      .jpeg()
      .toBuffer();
    const replaced = await replaceMedia(asset.id, { buffer: jpeg, filename: "other.jpg", mimeType: "image/jpeg" }, actor);
    assert(replaced.id === asset.id, "id kept on replace");
    assert(replaced.folderId === folder.id && replaced.alt === "New alt", "folder and alt kept on replace");
    assert(replaced.mimeType === "image/jpeg" && replaced.width === 64 && replaced.height === 32, "replace updated type + dims");
    assert(replaced.storageKey !== asset.storageKey, "replace uses a new key");
    assert(!existsSync(originalPath) && !existsSync(thumbPath), "old files removed after replace");
    assert(existsSync(localPath(replaced.storageKey!, "PUBLIC")), "new original on disk");
    assert(existsSync(localPath(`${replaced.storageKey}.thumb.webp`, "PUBLIC")), "new thumbnail on disk");
    console.log(`[ok] replaceMedia -> ${replaced.storageKey}`);

    // 10. Rejections: wrong declared kind, garbage bytes, folder not empty.
    await uploadMedia({ file: { buffer: jpeg, filename: "x.mp4", mimeType: "video/mp4" }, actor }).then(
      () => assert(false, "declared video / actual image must be rejected"),
      (error: Error) => assert(/does not match/.test(error.message), `kind mismatch message (got ${error.message})`),
    );
    await uploadMedia({ file: { buffer: Buffer.from("hello world, definitely not an image"), filename: "x.png", mimeType: "image/png" }, actor }).then(
      () => assert(false, "garbage must be rejected"),
      (error: Error) => assert(/Unsupported file type/.test(error.message), `garbage message (got ${error.message})`),
    );
    await deleteFolder(folder.id, actor).then(
      () => assert(false, "non-empty folder must not delete"),
      (error: Error) => assert(/Move or delete/.test(error.message), `folder-not-empty message (got ${error.message})`),
    );
    console.log("[ok] rejections: kind mismatch, garbage bytes, non-empty folder");

    // 11. Delete + cleanup.
    const outcome = await deleteMedia(asset.id, actor);
    assert(outcome.deleted, "deleteMedia deleted");
    assert((await db.mediaAsset.findUnique({ where: { id: asset.id } })) === null, "row gone");
    assert(!existsSync(localPath(replaced.storageKey!, "PUBLIC")), "original removed from disk");
    assert(!existsSync(localPath(`${replaced.storageKey}.thumb.webp`, "PUBLIC")), "thumbnail removed from disk");
    assetId = null;
    console.log("[ok] deleteMedia -> row + files removed");
  } finally {
    if (assetId) {
      // A failed assertion must not leave a row or files behind.
      await deleteMedia(assetId, actor).catch(() => undefined);
    }
    await deleteFolder(folder.id, actor);
    // The local driver removes files, not the (now empty) directories the
    // scratch folder created; the path is unique to this run, so prune it.
    rmSync(path.join(STORAGE_ROOT, "public", folder.path), { recursive: true, force: true });
    console.log("[ok] deleteFolder (+ empty storage directory pruned)");
  }

  console.log("\nALL CHECKS PASSED");
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
