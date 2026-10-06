import type { SellerDocument } from "@prisma/client";

import { badRequest, notFound } from "@/lib/api/errors";
import { writeAudit } from "@/lib/audit";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { db } from "@/lib/db";
import { SELLER_DOCUMENT_TYPE_META, type SellerDocumentType } from "@/lib/enums";

import { detectMimeType, uploadMedia } from "@/features/media/service";
import type { UploadFile } from "@/features/media/schemas";

import { actorIdOrNull, maybeAutoActivate, requireSeller, type Db, type SellerActor } from "@/features/sellers/core";
import { SELLER_DOCUMENT_MAX_BYTES, SELLER_DOCUMENT_MIME_TYPES } from "@/features/sellers/schemas";

/**
 * KYC documents (blueprint §4.4 SellerDocument, §14.C5, D6).
 *
 * A document is always a PRIVATE MediaAsset: the file is reachable only
 * through the audited admin route, never by URL. Verifying a document can be
 * the last brick of activation, so the review path ends with the C5
 * auto-activation check.
 */

export type AddDocumentInput = {
  sellerId: string;
  type: SellerDocumentType;
  label?: string | null;
  mediaId: string;
  actor: SellerActor;
  /** Who uploaded it: the seller (registration) or an operator on their behalf. */
  source: "registration" | "admin";
};

/** Media folder `sellers/<slug>` (created on demand) so KYC files are grouped per seller. */
export async function ensureSellerMediaFolder(tx: Db | typeof db, slug: string): Promise<string> {
  const segments = ["sellers", slug];
  let parentId: string | null = null;
  let path = "";
  for (const segment of segments) {
    path = path ? `${path}/${segment}` : segment;
    const existing = await tx.mediaFolder.findUnique({ where: { path }, select: { id: true } });
    if (existing) {
      parentId = existing.id;
      continue;
    }
    const created: { id: string } = await tx.mediaFolder.create({
      data: { path, name: segment, parentId },
      select: { id: true },
    });
    parentId = created.id;
  }
  return parentId as string;
}

export async function addSellerDocument(tx: Db, input: AddDocumentInput): Promise<SellerDocument> {
  const seller = await requireSeller(tx, input.sellerId);
  const media = await tx.mediaAsset.findUnique({
    where: { id: input.mediaId },
    select: { id: true, visibility: true, filename: true },
  });
  if (!media) throw notFound("Uploaded file");
  if (media.visibility !== "PRIVATE") throw badRequest("KYC documents must be private files.");

  const document = await tx.sellerDocument.create({
    data: {
      sellerId: seller.id,
      type: input.type,
      label: input.label?.trim() || SELLER_DOCUMENT_TYPE_META[input.type].label,
      mediaId: media.id,
      status: "PENDING",
    },
  });

  await writeAudit(tx, {
    actor: input.actor,
    action: "seller.document_add",
    entityType: "Seller",
    entityId: seller.id,
    entityLabel: seller.displayName,
    summary: `${input.source === "admin" ? "Uploaded" : "Seller submitted"} ${SELLER_DOCUMENT_TYPE_META[input.type].label} "${
      document.label
    }" for "${seller.displayName}".`,
    diff: { documentId: document.id, type: input.type, mediaId: media.id, filename: media.filename },
  });

  return document;
}

/**
 * Admin uploads on the seller's behalf: the bytes go through the media
 * service (type sniffed, images re-encoded) as PRIVATE into `sellers/<slug>`,
 * then the SellerDocument row is attached.
 */
export async function uploadSellerDocument(input: {
  sellerId: string;
  file: UploadFile;
  type: SellerDocumentType;
  label?: string | null;
  actor: SellerActor;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<SellerDocument> {
  const seller = await requireSeller(db, input.sellerId);
  if (input.file.buffer.byteLength > SELLER_DOCUMENT_MAX_BYTES) {
    throw badRequest("Documents must be 5 MB or smaller.", { file: "Too large (max 5 MB)." });
  }
  // Sniffed BEFORE storing so a refused type never leaves an orphaned asset.
  const detected = detectMimeType(input.file.buffer);
  if (!detected || !(SELLER_DOCUMENT_MIME_TYPES as readonly string[]).includes(detected)) {
    throw badRequest("Documents must be PDF, JPEG or PNG.", { file: "Unsupported type." });
  }

  const folderId = await ensureSellerMediaFolder(db, seller.slug);
  const asset = await uploadMedia({
    file: input.file,
    folderId,
    visibility: "PRIVATE",
    alt: `${SELLER_DOCUMENT_TYPE_META[input.type].label} - ${seller.displayName}`,
    actor: input.actor,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return db.$transaction((tx) =>
    addSellerDocument(tx, {
      sellerId: seller.id,
      type: input.type,
      label: input.label,
      mediaId: asset.id,
      actor: input.actor,
      source: "admin",
    }),
  );
}

export type ReviewDocumentResult = { document: SellerDocument; autoActivated: boolean };

/**
 * VERIFIED or REJECTED with a note; re-reviewing is allowed (a rejected scan
 * gets replaced by a new upload, but an operator may also correct a mistake).
 */
export async function reviewSellerDocument(input: {
  sellerId: string;
  documentId: string;
  status: "VERIFIED" | "REJECTED";
  note?: string | null;
  actor: SellerActor;
}): Promise<ReviewDocumentResult> {
  const result = await db.$transaction(async (tx) => {
    const seller = await requireSeller(tx, input.sellerId);
    const before = await tx.sellerDocument.findFirst({ where: { id: input.documentId, sellerId: seller.id } });
    if (!before) throw notFound("Document");

    const document = await tx.sellerDocument.update({
      where: { id: before.id },
      data: {
        status: input.status,
        note: input.note?.trim() || null,
        reviewedById: actorIdOrNull(input.actor),
        reviewedAt: new Date(),
      },
    });

    await writeAudit(tx, {
      actor: input.actor,
      action: "seller.document_review",
      entityType: "Seller",
      entityId: seller.id,
      entityLabel: seller.displayName,
      summary: `${input.status === "VERIFIED" ? "Verified" : "Rejected"} ${SELLER_DOCUMENT_TYPE_META[before.type as SellerDocumentType]?.label ?? before.type} "${
        before.label ?? before.id
      }" for "${seller.displayName}"${input.note ? `: ${input.note}` : ""}.`,
      diff: { documentId: before.id, status: { from: before.status, to: input.status }, note: document.note },
    });

    const autoActivated = input.status === "VERIFIED" ? await maybeAutoActivate(tx, seller.id, input.actor) : false;
    return { document, autoActivated };
  });

  if (result.autoActivated) await invalidatePublic(listTagsFor("seller"));
  return result;
}
