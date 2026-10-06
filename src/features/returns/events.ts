import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type { AuditActor } from "@/lib/audit";
import type { ReturnRequestStatus } from "@/lib/enums";

/**
 * The few pieces the RETURNS module shares with the REFUNDS module.
 *
 * This file deliberately holds no business rules: it exists so that
 * `refunds/service.ts` can write a return event and nudge an RMA forward when
 * its refund completes WITHOUT importing `returns/service.ts`, which imports
 * `refunds/service.ts` to create refunds in the first place. One leaf module
 * breaks what would otherwise be an import cycle.
 */

export type Db = Prisma.TransactionClient;
export type ReturnActor = AuditActor;

/** An RMA touches the order, its lines, stock and the ledger: 5 s is not enough. */
export const RETURN_TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 } as const;

export function runReturnTx<T>(body: (tx: Db) => Promise<T>): Promise<T> {
  return db.$transaction(body, RETURN_TX_OPTIONS);
}

export async function addReturnEvent(
  tx: Db,
  input: {
    returnRequestId: string;
    message: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    /** Internal events never reach the customer's tracking view (D11). */
    isInternal?: boolean;
    actorId?: string | null;
  },
): Promise<{ id: string }> {
  return tx.returnEvent.create({
    data: {
      returnRequestId: input.returnRequestId,
      message: input.message,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      isInternal: input.isInternal ?? true,
      actorId: input.actorId ?? null,
    },
    select: { id: true },
  });
}

/**
 * Called by the refunds service after a Refund changes status.
 *
 * A refund is the thing that finishes an RMA, so the RMA follows the refund
 * rather than the other way round: COMPLETED moves REFUND_INITIATED →
 * REFUND_COMPLETED, and a FAILED refund deliberately leaves the RMA where it
 * is (C4: "refund FAILED keeps REFUND_INITIATED") so a retry needs no
 * un-transition. Returns the new status when it changed, else null.
 */
export async function advanceReturnAfterRefund(
  tx: Db,
  refundId: string,
  actor: ReturnActor,
): Promise<{ returnRequestId: string; rmaNumber: string; toStatus: ReturnRequestStatus } | null> {
  const refund = await tx.refund.findUnique({
    where: { id: refundId },
    select: {
      status: true,
      refundNumber: true,
      returnRequest: { select: { id: true, rmaNumber: true, status: true } },
    },
  });
  const rma = refund?.returnRequest;
  if (!refund || !rma) return null;
  if (refund.status !== "COMPLETED" || rma.status !== "REFUND_INITIATED") return null;

  await tx.returnRequest.update({
    where: { id: rma.id },
    data: { status: "REFUND_COMPLETED" },
  });
  await addReturnEvent(tx, {
    returnRequestId: rma.id,
    fromStatus: rma.status,
    toStatus: "REFUND_COMPLETED",
    message: `Refund ${refund.refundNumber} completed.`,
    isInternal: false,
    actorId: actor.id || null,
  });
  return { returnRequestId: rma.id, rmaNumber: rma.rmaNumber, toStatus: "REFUND_COMPLETED" };
}
