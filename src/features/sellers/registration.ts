import bcrypt from "bcryptjs";

import { ApiError, badRequest } from "@/lib/api/errors";
import { SYSTEM_ACTOR, writeAudit } from "@/lib/audit";
import { randomToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { ImageProcessingError, processImageUpload } from "@/lib/images";
import { buildStorageKey, extensionForMime, getStorage, kindForMime } from "@/lib/storage";
import { slugify } from "@/lib/validation";

import { readSettingBoolean } from "@/features/finance/settings-reader";
import { detectMimeType, PRIVATE_FILE_ROUTE } from "@/features/media/service";
import { emitEvent } from "@/features/notifications/service";

import { addSellerDocument, ensureSellerMediaFolder } from "@/features/sellers/documents";
import type { Db } from "@/features/sellers/core";
import { SELLER_DOCUMENT_MAX_BYTES, SELLER_DOCUMENT_MIME_TYPES, type RegisterSellerValues } from "@/features/sellers/schemas";

/**
 * Public registration intake (blueprint §14.C6, D6).
 *
 * Two steps for the website: upload each KYC file to
 * `POST /api/v1/uploads/seller-document` (stored PRIVATE at once, an opaque
 * token comes back), then `POST /api/v1/sellers/register` with the profile and
 * the tokens. The register call exchanges every token for a PRIVATE MediaAsset
 * + SellerDocument inside the seller's transaction, so a file is never
 * referenced by a seller row that failed to commit, and the purge job can
 * delete what nobody claimed after 24 h.
 *
 * No `server-only` / `next/*` imports (G3).
 */

export const PENDING_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const BCRYPT_ROUNDS = 12;

/** Always the same sentence: an attacker must not learn which emails are registered. */
export const REGISTRATION_ACCEPTED_MESSAGE =
  "Thanks for registering. We will review your details and email you once your seller account has been approved.";

// ---------------------------------------------------------------------------
// Pending upload (POST /api/v1/uploads/seller-document)
// ---------------------------------------------------------------------------

export type PendingSellerUpload = { uploadToken: string; expiresAt: Date; filename: string; mimeType: string; sizeBytes: number };

/**
 * Sniff the type (the claimed Content-Type is ignored), bound the size,
 * re-encode images so EXIF and any embedded payload are gone, store PRIVATE
 * under `sellers/pending/yyyy/mm/<random>.<ext>` and hand back a token.
 */
export async function createPendingSellerUpload(input: {
  buffer: Buffer;
  filename: string | null;
  ip: string | null;
}): Promise<PendingSellerUpload> {
  if (input.buffer.byteLength === 0) throw badRequest("The file is empty.");
  if (input.buffer.byteLength > SELLER_DOCUMENT_MAX_BYTES) {
    throw badRequest("Documents must be 5 MB or smaller.", { file: "Too large (max 5 MB)." });
  }

  const detected = detectMimeType(input.buffer);
  if (!detected || !(SELLER_DOCUMENT_MIME_TYPES as readonly string[]).includes(detected)) {
    throw badRequest("Documents must be PDF, JPEG or PNG.", { file: "Unsupported type." });
  }

  let body = input.buffer;
  let mimeType = detected;
  let ext = extensionForMime(detected) ?? "bin";
  if (kindForMime(detected) === "image") {
    try {
      const processed = await processImageUpload(input.buffer, { thumbnail: false });
      body = processed.buffer;
      mimeType = processed.mimeType;
      ext = processed.ext;
    } catch (error) {
      if (error instanceof ImageProcessingError) throw badRequest(error.message, { file: error.message });
      throw error;
    }
  }

  const storage = await getStorage();
  const key = buildStorageKey({ folder: "sellers/pending", ext });
  await storage.put({ key, body, contentType: mimeType, visibility: "PRIVATE" });

  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + PENDING_UPLOAD_TTL_MS);
  try {
    await db.pendingUpload.create({
      data: { token, storageKey: key, mimeType, sizeBytes: body.byteLength, ip: input.ip, expiresAt },
    });
  } catch (error) {
    await storage.delete(key, "PRIVATE").catch(() => undefined);
    throw error;
  }

  const safeName = (input.filename ?? "").split(/[/\\]/).pop()?.replace(/[^\w. -]/g, "").trim().slice(0, 120) || `document.${ext}`;
  return { uploadToken: token, expiresAt, filename: safeName, mimeType, sizeBytes: body.byteLength };
}

/** Turn pending upload tokens into PRIVATE MediaAsset rows filed under the seller's folder. */
async function exchangeUploadTokens(
  tx: Db,
  tokens: readonly string[],
  folderId: string,
  filenamePrefix: string,
): Promise<Map<string, string>> {
  const unique = [...new Set(tokens)];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;

  const rows = await tx.pendingUpload.findMany({ where: { token: { in: unique } } });
  const byToken = new Map(rows.map((row) => [row.token, row]));
  const now = Date.now();
  const missing = unique.filter((token) => !byToken.has(token) || byToken.get(token)!.expiresAt.getTime() <= now);
  if (missing.length > 0) {
    throw badRequest("One of the uploaded documents has expired or is unknown. Please upload it again.", {
      documents: `${missing.length} invalid upload token${missing.length === 1 ? "" : "s"}`,
    });
  }

  const driver = (await getStorage()).driver;
  for (const token of unique) {
    const pending = byToken.get(token)!;
    const ext = pending.storageKey.split(".").pop() ?? "bin";
    const created = await tx.mediaAsset.create({
      data: {
        url: `pending:${pending.storageKey}`,
        storageKey: pending.storageKey,
        storageProvider: driver,
        visibility: "PRIVATE",
        filename: `${filenamePrefix}-${token.slice(0, 8)}.${ext}`,
        kind: kindForMime(pending.mimeType),
        mimeType: pending.mimeType,
        sizeBytes: pending.sizeBytes,
        folderId,
      },
      select: { id: true },
    });
    await tx.mediaAsset.update({ where: { id: created.id }, data: { url: PRIVATE_FILE_ROUTE(created.id) } });
    await tx.pendingUpload.delete({ where: { id: pending.id } });
    out.set(token, created.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Register (POST /api/v1/sellers/register)
// ---------------------------------------------------------------------------

export type RegisterSellerResult =
  | { accepted: true; sellerId: string; duplicate: false }
  /** The email already belongs to a seller; the caller answers exactly as for success. */
  | { accepted: true; sellerId: null; duplicate: true };

async function uniqueSlug(tx: Db, base: string): Promise<string> {
  const root = slugify(base) || "seller";
  const taken = new Set(
    (await tx.seller.findMany({ where: { slug: { startsWith: root } }, select: { slug: true } })).map((row) => row.slug),
  );
  if (!taken.has(root)) return root;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${root}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}-${randomToken(3)}`;
}

export async function registerSeller(input: RegisterSellerValues, meta: { ip: string | null }): Promise<RegisterSellerResult> {
  const open = await readSettingBoolean(undefined, "marketplace.seller_registration_open");
  if (!open) throw new ApiError(403, "FORBIDDEN", "Seller registration is currently closed.");

  const existing = await db.seller.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) {
    // Same response, same timing profile as far as practical: no enumeration.
    await writeAudit({
      actor: SYSTEM_ACTOR,
      action: "seller.register_duplicate",
      entityType: "Seller",
      entityId: existing.id,
      summary: "Storefront registration attempted with an email that already belongs to a seller.",
      ip: meta.ip,
      userAgent: null,
    });
    return { accepted: true, sellerId: null, duplicate: true };
  }

  const passwordHash = input.password ? await bcrypt.hash(input.password, BCRYPT_ROUNDS) : null;

  const sellerId = await db.$transaction(async (tx) => {
    const slug = await uniqueSlug(tx, input.displayName);
    const seller = await tx.seller.create({
      data: {
        slug,
        displayName: input.displayName,
        legalName: input.legalName ?? null,
        ownerName: input.ownerName,
        email: input.email,
        phone: input.phone,
        passwordHash,
        status: "PENDING",
        description: input.description ?? null,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2 ?? null,
        city: input.city,
        state: input.state,
        pinCode: input.pinCode,
        country: "IN",
        gstin: input.gstin ?? null,
        pan: input.pan ?? null,
      },
    });

    await tx.sellerEvent.create({
      data: { sellerId: seller.id, fromStatus: null, toStatus: "PENDING", message: "Registered from the storefront.", actorId: null },
    });

    if (input.documents.length > 0) {
      const folderId = await ensureSellerMediaFolder(tx, slug);
      const media = await exchangeUploadTokens(
        tx,
        input.documents.map((doc) => doc.uploadToken),
        folderId,
        `kyc-${slug}`,
      );
      for (const doc of input.documents) {
        await addSellerDocument(tx, {
          sellerId: seller.id,
          type: doc.type,
          label: doc.label,
          mediaId: media.get(doc.uploadToken) as string,
          actor: SYSTEM_ACTOR,
          source: "registration",
        });
      }
    }

    await writeAudit(tx, {
      actor: SYSTEM_ACTOR,
      action: "seller.register",
      entityType: "Seller",
      entityId: seller.id,
      entityLabel: seller.displayName,
      summary: `Seller "${seller.displayName}" registered from the storefront with ${input.documents.length} document${
        input.documents.length === 1 ? "" : "s"
      }.`,
      diff: { slug, city: input.city, state: input.state, documents: input.documents.length, hasPassword: Boolean(passwordHash) },
      ip: meta.ip,
      userAgent: null,
    });

    await emitEvent(
      "seller.registered",
      { sellerId: seller.id, sellerName: seller.displayName, sellerEmail: seller.email, city: seller.city },
      tx,
    );

    return seller.id;
  });

  return { accepted: true, sellerId, duplicate: false };
}
