import type { Coupon, Prisma } from "@prisma/client";

import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { db } from "@/lib/db";

import { evaluateCoupon, type CartLine, type CouponEvaluation } from "./rules";
import { generateCouponCode, type CouponBulkOp, type CouponFormValues } from "./schemas";

/**
 * Coupon mutations and the two functions the ORDERS module consumes at
 * checkout (blueprint §11.8, §14.B2, D13, F8).
 *
 * No `server-only` / `next/*` imports: the check script, node:test and the
 * order transaction all call in here directly. Cache invalidation and
 * `revalidatePath` belong to actions.ts.
 *
 * Deletion rule (F8): a coupon that was never redeemed is hard-deleted; one
 * with usage is soft-deleted (`deletedAt`) so `CouponUsage`/`Order` history
 * keeps its foreign key. The soft-deleted row's code is suffixed
 * (`-DELETED-<ts>`, mirroring §11.34 for slugs) so the code can be reused;
 * `Order.couponCode` snapshots the original.
 */

type Db = Prisma.TransactionClient;

const ORDER_STATUSES_NOT_COUNTED = ["CANCELLED", "FAILED"];

export class CouponUsageError extends Error {
  constructor(
    public readonly code: "EXHAUSTED" | "ALREADY_RECORDED" | "PER_CUSTOMER_LIMIT" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "CouponUsageError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function auditSnapshot(row: Coupon): Record<string, unknown> {
  const { createdAt, updatedAt, createdById, ...rest } = row;
  void createdAt;
  void updatedAt;
  void createdById;
  return rest;
}

/** Codes are stored uppercase; uniqueness is checked case-insensitively so "welcome10" cannot coexist with "WELCOME10". */
async function assertCodeAvailable(tx: Db, code: string, exceptId?: string): Promise<void> {
  const clash = await tx.coupon.findFirst({
    where: { code: { equals: code, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw conflict("That code is already in use by another coupon.", { code: "That code is already in use." });
}

async function loadCoupon(tx: Db, id: string): Promise<Coupon> {
  const row = await tx.coupon.findFirst({ where: { id, deletedAt: null } });
  if (!row) throw notFound("Coupon");
  return row;
}

function toCreateData(input: CouponFormValues): Prisma.CouponUncheckedCreateInput {
  return {
    code: input.code,
    name: input.name,
    description: input.description ?? null,
    type: input.type,
    value: input.value,
    maxDiscountPaise: input.maxDiscountPaise,
    minOrderPaise: input.minOrderPaise,
    appliesTo: input.appliesTo,
    categoryIds: input.categoryIds,
    productIds: input.productIds,
    sellerIds: input.sellerIds,
    excludedProductIds: input.excludedProductIds,
    firstOrderOnly: input.firstOrderOnly,
    customerIds: input.customerIds,
    usageLimit: input.usageLimit,
    perCustomerLimit: input.perCustomerLimit,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    isActive: input.isActive,
    isPublic: input.isPublic,
    fundedBy: input.fundedBy,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createCoupon(input: CouponFormValues, actor: AuditActor): Promise<Coupon> {
  return db.$transaction(async (tx) => {
    await assertCodeAvailable(tx, input.code);
    const row = await tx.coupon.create({ data: { ...toCreateData(input), createdById: actor.id } });
    await writeAudit(tx, {
      actor,
      action: "coupon.create",
      entityType: "coupon",
      entityId: row.id,
      entityLabel: row.code,
      summary: `Created coupon ${row.code} (${row.name}).`,
      diff: diffOf(null, auditSnapshot(row)),
    });
    return row;
  });
}

export async function updateCoupon(id: string, input: CouponFormValues, actor: AuditActor): Promise<Coupon> {
  return db.$transaction(async (tx) => {
    const before = await loadCoupon(tx, id);
    if (before.code !== input.code) await assertCodeAvailable(tx, input.code, id);
    const row = await tx.coupon.update({ where: { id }, data: toCreateData(input) });
    await writeAudit(tx, {
      actor,
      action: "coupon.update",
      entityType: "coupon",
      entityId: row.id,
      entityLabel: row.code,
      summary: `Updated coupon ${row.code}.`,
      diff: diffOf(auditSnapshot(before), auditSnapshot(row)),
    });
    return row;
  });
}

/** A fresh, disabled copy with a new code so nothing goes live by accident. */
export async function duplicateCoupon(id: string, actor: AuditActor): Promise<Coupon> {
  return db.$transaction(async (tx) => {
    const source = await loadCoupon(tx, id);
    let code = `${source.code}-COPY`.slice(0, 32);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const clash = await tx.coupon.findFirst({ where: { code: { equals: code, mode: "insensitive" } }, select: { id: true } });
      if (!clash) break;
      code = generateCouponCode(source.code.slice(0, 8), 4).slice(0, 32);
    }
    const { id: _id, createdAt, updatedAt, usageCount, deletedAt, createdById, ...rest } = source;
    void _id;
    void createdAt;
    void updatedAt;
    void usageCount;
    void deletedAt;
    void createdById;
    const row = await tx.coupon.create({
      data: { ...rest, code, name: `${source.name} (copy)`, isActive: false, usageCount: 0, createdById: actor.id },
    });
    await writeAudit(tx, {
      actor,
      action: "coupon.duplicate",
      entityType: "coupon",
      entityId: row.id,
      entityLabel: row.code,
      summary: `Duplicated coupon ${source.code} as ${row.code}.`,
      diff: diffOf(null, { sourceId: source.id, code: row.code }),
    });
    return row;
  });
}

export async function setCouponActive(id: string, isActive: boolean, actor: AuditActor): Promise<Coupon> {
  return db.$transaction(async (tx) => {
    const before = await loadCoupon(tx, id);
    if (before.isActive === isActive) return before;
    const row = await tx.coupon.update({ where: { id }, data: { isActive } });
    await writeAudit(tx, {
      actor,
      action: isActive ? "coupon.enable" : "coupon.disable",
      entityType: "coupon",
      entityId: row.id,
      entityLabel: row.code,
      summary: `${isActive ? "Enabled" : "Disabled"} coupon ${row.code}.`,
      diff: diffOf({ isActive: before.isActive }, { isActive }),
    });
    return row;
  });
}

export type DeleteCouponResult = { id: string; code: string; mode: "hard" | "soft" };

export async function deleteCoupon(id: string, actor: AuditActor, reason?: string): Promise<DeleteCouponResult> {
  return db.$transaction(async (tx) => {
    const row = await loadCoupon(tx, id);
    const result = await deleteCouponInTx(tx, row, actor, reason);
    return result;
  });
}

async function deleteCouponInTx(tx: Db, row: Coupon, actor: AuditActor, reason?: string): Promise<DeleteCouponResult> {
  // usageCount can lag behind the real rows only in the increment direction
  // (the conditional update runs before the CouponUsage insert), so count the
  // rows as well before deciding a hard delete is safe.
  const usages = row.usageCount > 0 ? row.usageCount : await tx.couponUsage.count({ where: { couponId: row.id } });
  const mode: "hard" | "soft" = usages > 0 ? "soft" : "hard";

  if (mode === "hard") {
    await tx.coupon.delete({ where: { id: row.id } });
  } else {
    await tx.coupon.update({
      where: { id: row.id },
      data: { deletedAt: new Date(), isActive: false, code: `${row.code}-DELETED-${Date.now()}`.slice(0, 64) },
    });
  }

  await writeAudit(tx, {
    actor,
    action: "coupon.delete",
    entityType: "coupon",
    entityId: row.id,
    entityLabel: row.code,
    summary:
      mode === "hard"
        ? `Deleted coupon ${row.code}${reason ? ` - ${reason}` : ""}.`
        : `Archived coupon ${row.code} (${usages} redemption${usages === 1 ? "" : "s"} kept)${reason ? ` - ${reason}` : ""}.`,
    diff: diffOf(auditSnapshot(row), null),
  });
  return { id: row.id, code: row.code, mode };
}

export type BulkCouponResult = { op: CouponBulkOp; requested: number; affected: number; skipped: number };

/** One transaction, capped at 500 ids by the schema (§11.33). */
export async function bulkCoupons(input: { ids: string[]; op: CouponBulkOp }, actor: AuditActor): Promise<BulkCouponResult> {
  return db.$transaction(async (tx) => {
    const rows = await tx.coupon.findMany({ where: { id: { in: input.ids }, deletedAt: null } });
    let affected = 0;

    if (input.op === "DELETE") {
      for (const row of rows) {
        await deleteCouponInTx(tx, row, actor);
        affected += 1;
      }
    } else {
      const isActive = input.op === "ENABLE";
      const targets = rows.filter((row) => row.isActive !== isActive);
      if (targets.length > 0) {
        await tx.coupon.updateMany({ where: { id: { in: targets.map((row) => row.id) } }, data: { isActive } });
      }
      affected = targets.length;
    }

    await writeAudit(tx, {
      actor,
      action: `coupon.bulk_${input.op.toLowerCase()}`,
      entityType: "coupon",
      summary: `Bulk ${input.op.toLowerCase()} on ${input.ids.length} coupon${input.ids.length === 1 ? "" : "s"} (${affected} changed).`,
      diff: diffOf(null, { op: input.op, requested: input.ids.length, affected }),
    });

    return { op: input.op, requested: input.ids.length, affected, skipped: input.ids.length - affected };
  });
}

// ---------------------------------------------------------------------------
// Checkout contract (consumed by the orders module and /api/v1/coupons/validate)
// ---------------------------------------------------------------------------

export type ValidateCouponInput = {
  code: string;
  lines: readonly CartLine[];
  customerEmail?: string | null;
  customerId?: string | null;
  /** Discounted item subtotal (Σ lineGross − promotion). Computed from lines when omitted. */
  subtotalPaise?: number;
  shippingPaise?: number;
  now?: Date;
  tx?: Db;
};

export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Load the coupon and the customer facts, then hand everything to the pure
 * rule engine. Passing `tx` runs the reads inside the caller's transaction so
 * checkout sees the same row it will later increment.
 */
export async function validateCouponForCart(input: ValidateCouponInput): Promise<CouponEvaluation> {
  const client: Db = input.tx ?? db;
  const code = normalizeCouponCode(input.code);
  if (!code) return { ok: false, reason: "NOT_FOUND", message: "No coupon with that code exists." };

  const coupon = await client.coupon.findFirst({ where: { code, deletedAt: null } });
  if (!coupon) return { ok: false, reason: "NOT_FOUND", message: "No coupon with that code exists." };

  const email = input.customerEmail?.trim().toLowerCase() || null;
  let customerId = input.customerId ?? null;
  if (!customerId && email) {
    const customer = await client.customer.findFirst({ where: { email, deletedAt: null }, select: { id: true } });
    customerId = customer?.id ?? null;
  }

  const [scopeCategories, usageCount, priorOrderCount] = await Promise.all([
    coupon.appliesTo === "CATEGORIES" && coupon.categoryIds.length > 0
      ? client.category.findMany({ where: { id: { in: coupon.categoryIds } }, select: { id: true, path: true } })
      : Promise.resolve([]),
    customerId ? client.couponUsage.count({ where: { couponId: coupon.id, customerId } }) : Promise.resolve(0),
    coupon.firstOrderOnly && (customerId || email)
      ? client.order.count({
          where: {
            status: { notIn: ORDER_STATUSES_NOT_COUNTED },
            OR: [...(customerId ? [{ customerId }] : []), ...(email ? [{ guestEmail: email }] : [])],
          },
        })
      : Promise.resolve(0),
  ]);

  return evaluateCoupon({
    coupon,
    lines: input.lines,
    scopeCategories,
    customer: { customerId, email, usageCount, priorOrderCount },
    subtotalPaise: input.subtotalPaise,
    shippingPaise: input.shippingPaise,
    now: input.now,
  });
}

export type RecordCouponUsageInput = {
  couponId: string;
  orderId: string;
  customerId?: string | null;
  discountPaise: number;
};

/**
 * Count a redemption inside the order transaction (§11.8, F8). The increment
 * is CONDITIONAL - `usageCount < usageLimit` is evaluated by Postgres in the
 * same statement - so two checkouts racing for the last redemption cannot
 * both win: exactly one UPDATE matches, the other throws EXHAUSTED and the
 * caller rolls its order back. `@@unique([couponId, orderId])` makes a retry
 * of the same order idempotent (ALREADY_RECORDED).
 */
export async function recordCouponUsage(tx: Db, input: RecordCouponUsageInput): Promise<{ usageId: string; usageCount: number }> {
  const existing = await tx.couponUsage.findUnique({
    where: { couponId_orderId: { couponId: input.couponId, orderId: input.orderId } },
    select: { id: true },
  });
  if (existing) throw new CouponUsageError("ALREADY_RECORDED", "This order has already redeemed the coupon.");

  if (input.customerId) {
    const coupon = await tx.coupon.findUnique({ where: { id: input.couponId }, select: { perCustomerLimit: true } });
    if (!coupon) throw new CouponUsageError("NOT_FOUND", "The coupon no longer exists.");
    if (coupon.perCustomerLimit !== null) {
      const used = await tx.couponUsage.count({ where: { couponId: input.couponId, customerId: input.customerId } });
      if (used >= coupon.perCustomerLimit) {
        throw new CouponUsageError("PER_CUSTOMER_LIMIT", "This customer has already used the coupon the maximum number of times.");
      }
    }
  }

  const matched = await tx.$executeRaw`
    UPDATE "Coupon"
       SET "usageCount" = "usageCount" + 1, "updatedAt" = NOW()
     WHERE "id" = ${input.couponId}
       AND "deletedAt" IS NULL
       AND "isActive" = TRUE
       AND ("usageLimit" IS NULL OR "usageCount" < "usageLimit")`;
  if (matched !== 1) {
    throw new CouponUsageError("EXHAUSTED", "This coupon has reached its usage limit or is no longer active.");
  }

  const usage = await tx.couponUsage.create({
    data: {
      couponId: input.couponId,
      orderId: input.orderId,
      customerId: input.customerId ?? null,
      discountPaise: Math.max(0, Math.round(input.discountPaise)),
    },
    select: { id: true, coupon: { select: { usageCount: true } } },
  });
  return { usageId: usage.id, usageCount: usage.coupon.usageCount };
}

/**
 * Undo a redemption when an order is cancelled before fulfilment, giving the
 * slot back to other customers. No-op when nothing was recorded.
 */
export async function releaseCouponUsage(tx: Db, input: { couponId: string; orderId: string }): Promise<boolean> {
  const deleted = await tx.couponUsage.deleteMany({ where: { couponId: input.couponId, orderId: input.orderId } });
  if (deleted.count === 0) return false;
  await tx.$executeRaw`
    UPDATE "Coupon"
       SET "usageCount" = GREATEST("usageCount" - 1, 0), "updatedAt" = NOW()
     WHERE "id" = ${input.couponId}`;
  return true;
}

/** Guard used by the REST layer for `?code=` lookups. */
export function assertCouponCode(code: unknown): string {
  if (typeof code !== "string" || !code.trim()) throw badRequest("A coupon code is required.");
  return normalizeCouponCode(code);
}
