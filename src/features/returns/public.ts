import { badRequest, notFound } from "@/lib/api/errors";
import { constantTimeEqual, hashToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { RETURN_REASON_META, RETURN_REQUEST_STATUS_META, type ReturnReason, type ReturnRequestStatus } from "@/lib/enums";
import { getStorage, kindForMime } from "@/lib/storage";

import { runReturnTx, type Db } from "./events";
import { createReturnRequestInTx } from "./service";
import type { PublicReturnValues } from "./schemas";

/**
 * The customer-facing face of a return (blueprint §5.3, §14.D1, D9, D11).
 *
 * Authentication is the D1 order access token and nothing else: it is hashed
 * and compared in constant time, and a wrong token is reported exactly like an
 * unknown order number so the endpoint cannot be used to enumerate orders.
 *
 * The status view is an explicit allowlist (D11). It carries no internal
 * events, no QC notes, no seller, no customer id and no money the customer was
 * not already told about.
 */

export const RETURN_MEDIA_FOLDER = "returns";

/** The one place an order number + token becomes an order id. */
async function resolveOrder(orderNumber: string, token: string): Promise<{ id: string } | null> {
  const order = await db.order.findUnique({
    where: { orderNumber },
    select: { id: true, accessTokenHash: true },
  });
  if (!order?.accessTokenHash) return null;
  if (!constantTimeEqual(order.accessTokenHash, hashToken(token))) return null;
  return { id: order.id };
}

/**
 * PendingUpload tokens → PUBLIC MediaAsset rows filed under `returns/`. The
 * uploaded object keeps its storage key; only the ownership changes, so the
 * purge job stops treating it as abandoned. Mirrors the reviews module's
 * exchange (that one is private to its service, hence the second copy).
 */
async function exchangeReturnUploads(tx: Db, tokens: readonly string[], now: Date): Promise<string[]> {
  const unique = [...new Set(tokens)];
  if (unique.length === 0) return [];

  const rows = await tx.pendingUpload.findMany({ where: { token: { in: unique } } });
  if (rows.length !== unique.length) {
    throw badRequest("One of the photos is no longer available. Please upload it again.", { images: "Unknown upload token." });
  }
  if (rows.some((row) => row.expiresAt <= now)) {
    throw badRequest("One of the photos has expired. Please upload it again.", { images: "Expired upload token." });
  }

  const storage = await getStorage();
  const folder = await tx.mediaFolder.findUnique({ where: { path: RETURN_MEDIA_FOLDER }, select: { id: true } });
  const folderId =
    folder?.id ??
    (await tx.mediaFolder.create({ data: { path: RETURN_MEDIA_FOLDER, name: RETURN_MEDIA_FOLDER, parentId: null }, select: { id: true } })).id;

  const urls: string[] = [];
  for (const token of unique) {
    const pending = rows.find((row) => row.token === token)!;
    const url = storage.publicUrl(pending.storageKey);
    await tx.mediaAsset.create({
      data: {
        url,
        storageKey: pending.storageKey,
        storageProvider: storage.driver,
        visibility: "PUBLIC",
        filename: `return-${token.slice(0, 8)}.${pending.storageKey.split(".").pop() ?? "jpg"}`,
        kind: kindForMime(pending.mimeType),
        mimeType: pending.mimeType,
        sizeBytes: pending.sizeBytes,
        folderId,
      },
      select: { id: true },
    });
    await tx.pendingUpload.delete({ where: { id: pending.id } });
    urls.push(url);
  }
  return urls;
}

export type PublicReturnResult = { rmaNumber: string; status: ReturnRequestStatus; message: string };

export const RETURN_SUBMITTED_MESSAGE =
  "Your return request has been received. We will email you once it has been reviewed.";

/**
 * POST /api/v1/returns. Everything is re-validated server-side: the token,
 * that the line belongs to that order, that it was delivered inside the
 * window, and that the quantity is still available (C4).
 */
export async function submitPublicReturn(input: {
  values: PublicReturnValues;
  ip: string | null;
}): Promise<PublicReturnResult> {
  const { values } = input;
  const order = await resolveOrder(values.orderNumber, values.token);
  // D1: a wrong token answers exactly like an unknown order number.
  if (!order) throw notFound("Order");

  return runReturnTx(async (tx) => {
    const imageUrls = await exchangeReturnUploads(tx, values.images ?? [], new Date());
    const created = await createReturnRequestInTx(tx, {
      orderId: order.id,
      orderItemId: values.orderItemId,
      quantity: values.quantity,
      reason: values.reason,
      reasonDetail: values.reasonDetail ?? null,
      requestedResolution: values.requestedResolution ?? null,
      imageUrls,
      actor: null,
      source: "STOREFRONT",
    });
    return { rmaNumber: created.rmaNumber, status: created.status, message: RETURN_SUBMITTED_MESSAGE };
  });
}

// ---------------------------------------------------------------------------
// GET /api/v1/returns/:rma?token=   (D11 allowlist)
// ---------------------------------------------------------------------------

export type PublicReturn = {
  rmaNumber: string;
  orderNumber: string;
  status: string;
  statusLabel: string;
  reason: string;
  reasonLabel: string;
  reasonDetail: string | null;
  requestedResolution: string | null;
  resolution: string | null;
  quantity: number;
  item: { title: string; variant: string | null; imageUrl: string | null };
  images: string[];
  pickupScheduledAt: Date | null;
  pickupTrackingNumber: string | null;
  receivedAt: Date | null;
  requestedAt: Date;
  resolvedAt: Date | null;
  rejectionReason: string | null;
  /** Only what the customer needs: no provider ids, no internal notes. */
  refund: { number: string; amount: number; status: string; method: string; completedAt: Date | null } | null;
  events: Array<{ status: string | null; message: string; at: Date }>;
};

export async function getPublicReturn(rmaNumber: string, token: string | null): Promise<PublicReturn | null> {
  if (!token) return null;
  const rma = await db.returnRequest.findUnique({
    where: { rmaNumber },
    select: {
      rmaNumber: true,
      status: true,
      reason: true,
      reasonDetail: true,
      requestedResolution: true,
      resolution: true,
      rejectionReason: true,
      quantity: true,
      imageUrls: true,
      pickupScheduledAt: true,
      pickupTrackingNumber: true,
      receivedAt: true,
      requestedAt: true,
      resolvedAt: true,
      order: { select: { orderNumber: true, accessTokenHash: true } },
      orderItem: { select: { titleSnapshot: true, variantSnapshot: true, imageUrl: true } },
      refund: { select: { refundNumber: true, amountPaise: true, status: true, method: true, completedAt: true } },
      events: {
        where: { isInternal: false },
        orderBy: { createdAt: "asc" },
        select: { toStatus: true, message: true, createdAt: true },
      },
    },
  });
  if (!rma?.order.accessTokenHash) return null;
  if (!constantTimeEqual(rma.order.accessTokenHash, hashToken(token))) return null;

  return {
    rmaNumber: rma.rmaNumber,
    orderNumber: rma.order.orderNumber,
    status: rma.status,
    statusLabel: RETURN_REQUEST_STATUS_META[rma.status as ReturnRequestStatus]?.label ?? rma.status,
    reason: rma.reason,
    reasonLabel: RETURN_REASON_META[rma.reason as ReturnReason]?.label ?? rma.reason,
    reasonDetail: rma.reasonDetail,
    requestedResolution: rma.requestedResolution,
    resolution: rma.resolution,
    quantity: rma.quantity,
    item: {
      title: rma.orderItem.titleSnapshot,
      variant: rma.orderItem.variantSnapshot,
      imageUrl: rma.orderItem.imageUrl,
    },
    images: rma.imageUrls,
    pickupScheduledAt: rma.pickupScheduledAt,
    pickupTrackingNumber: rma.pickupTrackingNumber,
    receivedAt: rma.receivedAt,
    requestedAt: rma.requestedAt,
    resolvedAt: rma.resolvedAt,
    rejectionReason: rma.rejectionReason,
    refund: rma.refund
      ? {
          number: rma.refund.refundNumber,
          // Money is rupees on the public API (A10).
          amount: rma.refund.amountPaise / 100,
          status: rma.refund.status,
          method: rma.refund.method,
          completedAt: rma.refund.completedAt,
        }
      : null,
    events: rma.events.map((event) => ({ status: event.toStatus, message: event.message, at: event.createdAt })),
  };
}
