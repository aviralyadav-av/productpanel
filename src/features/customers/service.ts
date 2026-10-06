import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { hashToken, randomToken } from "@/lib/crypto";
import type { AddressType, CustomerStatus } from "@/lib/enums";
import { getSettings, getSettingString } from "@/lib/settings";
import { normalizePhone } from "@/lib/validation";
import { emitEvent } from "@/features/notifications/service";

import { anonymisePatch, DEFAULT_SEGMENT_THRESHOLDS, normaliseEmail, normaliseTags, type SegmentThresholds } from "./domain";
import type { AddressValues, BulkRequest, CustomerFormValues, CustomerPatch } from "./schemas";

/**
 * The pure segment rules live in ./domain.ts (no database, unit-tested) but
 * are re-exported here so a consumer needs one import for "everything the
 * customers module does".
 */
export {
  anonymisedEmail,
  anonymisePatch,
  averageOrderValue,
  DEFAULT_SEGMENT_THRESHOLDS,
  isAnonymisedEmail,
  normaliseEmail,
  normaliseTags,
  segmentFor,
  segmentsFor,
  segmentWhere,
} from "./domain";
export type { SegmentInput, SegmentThresholds } from "./domain";

/**
 * Customer business logic (blueprint section 1 Customers, 4.5, C7, E7, D13).
 * Pure service: no `server-only`, no `next/*`, so the worker, the seed, the
 * check script and the REST handlers can all call it. Every mutation runs in
 * one transaction with its audit row (reads happen first, the audit diff is
 * computed from before/after) and returns the fresh core row.
 *
 * Website-facing operations (upsert, wishlist, cart, sessions, credentials)
 * live in ./integration-service.ts; both share the helpers exported here.
 */

export type CustomerActor = AuditActor;
type Tx = Prisma.TransactionClient;
type Options = { ip?: string | null; reason?: string | null };

export const CUSTOMER_CORE_SELECT = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  status: true,
  emailVerifiedAt: true,
  acceptsMarketing: true,
  notes: true,
  tags: true,
  orderCount: true,
  totalSpentPaise: true,
  firstOrderAt: true,
  lastOrderAt: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} satisfies Prisma.CustomerSelect;

export type CustomerCore = Prisma.CustomerGetPayload<{ select: typeof CUSTOMER_CORE_SELECT }>;

export const ADDRESS_SELECT = {
  id: true,
  customerId: true,
  label: true,
  fullName: true,
  phone: true,
  line1: true,
  line2: true,
  landmark: true,
  city: true,
  state: true,
  pinCode: true,
  country: true,
  type: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AddressSelect;

export type AddressRecord = Prisma.AddressGetPayload<{ select: typeof ADDRESS_SELECT }>;

/** Reset links live for an hour: long enough for a slow inbox, short enough to limit a leaked link. */
export const CUSTOMER_RESET_TTL_MINUTES = 60;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const THRESHOLD_KEYS = {
  newDays: "customers.new_days",
  returningMinOrders: "customers.returning_min_orders",
  vipMinOrders: "customers.vip_min_orders",
  highValueMinSpendPaise: "customers.high_value_min_spend_paise",
  inactiveDays: "customers.inactive_days",
} as const;

/** Segment thresholds from settings (C7), falling back to the seeded defaults for anything unparseable. */
export async function resolveSegmentThresholds(): Promise<SegmentThresholds> {
  const values = await getSettings(Object.values(THRESHOLD_KEYS));
  const pick = (key: keyof SegmentThresholds): number => {
    const value = Number(values[THRESHOLD_KEYS[key]]);
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_SEGMENT_THRESHOLDS[key];
  };
  return {
    newDays: pick("newDays"),
    returningMinOrders: pick("returningMinOrders"),
    vipMinOrders: pick("vipMinOrders"),
    highValueMinSpendPaise: pick("highValueMinSpendPaise"),
    inactiveDays: pick("inactiveDays"),
  };
}

/** `${storefront.base_url}` without a trailing slash, for links in customer emails. */
export async function storefrontBaseUrl(): Promise<string> {
  const raw = (await getSettingString("storefront.base_url")).trim();
  return raw.replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// Lookups shared by the admin and integration services
// ---------------------------------------------------------------------------

export async function loadCustomer(tx: Tx, id: string): Promise<CustomerCore> {
  const customer = await tx.customer.findUnique({ where: { id }, select: CUSTOMER_CORE_SELECT });
  if (!customer) throw notFound("Customer");
  return customer;
}

/** A live (not soft-deleted) customer, or 404. Deleted customers are read-only history. */
export async function loadLiveCustomer(tx: Tx, id: string): Promise<CustomerCore> {
  const customer = await loadCustomer(tx, id);
  if (customer.deletedAt) throw notFound("Customer");
  return customer;
}

/**
 * Email uniqueness is case-insensitive even though the column is a plain
 * unique index: the value is normalised on every write path, so a citext
 * lookup is only needed for rows written before that rule existed.
 */
export async function findCustomerByEmail(tx: Tx | typeof db, email: string): Promise<CustomerCore | null> {
  const normalised = normaliseEmail(email);
  return tx.customer.findFirst({
    where: { email: { equals: normalised, mode: "insensitive" }, deletedAt: null },
    select: CUSTOMER_CORE_SELECT,
  });
}

async function assertEmailFree(tx: Tx, email: string, exceptId?: string): Promise<void> {
  const existing = await tx.customer.findFirst({
    where: { email: { equals: normaliseEmail(email), mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, deletedAt: true },
  });
  if (existing) throw conflict("A customer with this email already exists.", { email: "Already registered." });
}

/**
 * Phone numbers are stored in exactly one shape (+91XXXXXXXXXX, else E.164)
 * so list search and the website's lookups agree on what "the same number"
 * means. The zod schemas already normalise on the way in, but the service
 * repeats it because the seed, the check script and other modules call these
 * functions with plain objects; a second shape in the column silently breaks
 * phone search. `normalizePhone` is idempotent, so re-running it is free, and
 * an unrecognised number is kept verbatim rather than dropped - the boundary
 * schema is what rejects nonsense.
 */
export function normalisePhoneValue(phone: string | null | undefined): string | null {
  if (phone === null || phone === undefined) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;
  return normalizePhone(trimmed) ?? trimmed;
}

function label(customer: { email: string; fullName: string | null }): string {
  return customer.fullName ? `${customer.fullName} <${customer.email}>` : customer.email;
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export async function createCustomer(input: CustomerFormValues, actor: CustomerActor, options: Options = {}): Promise<CustomerCore> {
  return db.$transaction(async (tx) => {
    await assertEmailFree(tx, input.email);
    const customer = await tx.customer.create({
      data: {
        email: normaliseEmail(input.email),
        fullName: input.fullName,
        phone: normalisePhoneValue(input.phone),
        acceptsMarketing: input.acceptsMarketing,
        tags: normaliseTags(input.tags),
        notes: input.notes,
      },
      select: CUSTOMER_CORE_SELECT,
    });
    if (input.address) {
      await tx.address.create({ data: { ...input.address, isDefault: true, customerId: customer.id } });
    }
    await writeAudit(tx, {
      actor,
      action: "customer.create",
      entityType: "customer",
      entityId: customer.id,
      entityLabel: label(customer),
      summary: `Created customer ${label(customer)}.`,
      diff: diffOf(null, { email: customer.email, fullName: customer.fullName, phone: customer.phone, tags: customer.tags, acceptsMarketing: customer.acceptsMarketing }),
      ip: options.ip,
    });
    return customer;
  });
}

export async function updateCustomer(id: string, patch: CustomerPatch, actor: CustomerActor, options: Options = {}): Promise<CustomerCore> {
  return db.$transaction(async (tx) => {
    const before = await loadLiveCustomer(tx, id);
    const data: Prisma.CustomerUpdateInput = {};
    if (patch.email !== undefined && normaliseEmail(patch.email) !== before.email) {
      await assertEmailFree(tx, patch.email, id);
      data.email = normaliseEmail(patch.email);
      // A changed address is no longer the verified one.
      data.emailVerifiedAt = null;
    }
    if (patch.fullName !== undefined) data.fullName = patch.fullName;
    if (patch.phone !== undefined) data.phone = normalisePhoneValue(patch.phone);
    if (patch.acceptsMarketing !== undefined) data.acceptsMarketing = patch.acceptsMarketing;
    if (patch.tags !== undefined) data.tags = normaliseTags(patch.tags);
    if (patch.notes !== undefined) data.notes = patch.notes;

    const after = await tx.customer.update({ where: { id }, data, select: CUSTOMER_CORE_SELECT });
    const diff = diffOf(
      { email: before.email, fullName: before.fullName, phone: before.phone, acceptsMarketing: before.acceptsMarketing, tags: before.tags, notes: before.notes },
      { email: after.email, fullName: after.fullName, phone: after.phone, acceptsMarketing: after.acceptsMarketing, tags: after.tags, notes: after.notes },
    );
    if (diff) {
      await writeAudit(tx, {
        actor,
        action: "customer.update",
        entityType: "customer",
        entityId: id,
        entityLabel: label(after),
        summary: `Updated customer ${label(after)}.`,
        diff,
        ip: options.ip,
      });
    }
    return after;
  });
}

// ---------------------------------------------------------------------------
// Status (block / unblock)
// ---------------------------------------------------------------------------

/**
 * Blocking revokes every website session at the same time: a blocked customer
 * who stays signed in is not blocked. Unblocking never restores sessions.
 */
export async function setCustomerStatus(id: string, status: CustomerStatus, actor: CustomerActor, options: Options = {}): Promise<CustomerCore> {
  return db.$transaction(async (tx) => {
    const before = await loadLiveCustomer(tx, id);
    if (before.status === status) return before;
    if (status === "BLOCKED" && !options.reason?.trim()) throw badRequest("A reason is required to block a customer.", { reason: "Required." });

    const after = await tx.customer.update({ where: { id }, data: { status }, select: CUSTOMER_CORE_SELECT });
    if (status === "BLOCKED") await revokeCustomerSessions(tx, id);

    await writeAudit(tx, {
      actor,
      action: status === "BLOCKED" ? "customer.block" : "customer.unblock",
      entityType: "customer",
      entityId: id,
      entityLabel: label(after),
      summary: `${status === "BLOCKED" ? "Blocked" : "Unblocked"} customer ${label(after)}${options.reason ? `: ${options.reason}` : "."}`,
      diff: { status: { from: before.status, to: after.status }, reason: options.reason ?? null },
      ip: options.ip,
    });
    return after;
  });
}

/** Marks every live session revoked; returns how many. Shared by block, delete and password reset. */
export async function revokeCustomerSessions(tx: Tx, customerId: string, now = new Date()): Promise<number> {
  const result = await tx.customerSession.updateMany({ where: { customerId, revokedAt: null }, data: { revokedAt: now } });
  return result.count;
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/**
 * "Default per type": a default SHIPPING address displaces other SHIPPING and
 * BOTH defaults, a default BOTH displaces everything. Run before the write so
 * the invariant holds inside the same transaction.
 */
async function clearDefaults(tx: Tx, customerId: string, type: AddressType, exceptId?: string): Promise<void> {
  const overlapping: AddressType[] = type === "BOTH" ? ["SHIPPING", "BILLING", "BOTH"] : [type, "BOTH"];
  await tx.address.updateMany({
    where: { customerId, isDefault: true, type: { in: overlapping }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { isDefault: false },
  });
}

export async function createAddress(customerId: string, values: AddressValues, actor: CustomerActor, options: Options = {}): Promise<AddressRecord> {
  return db.$transaction(async (tx) => {
    const customer = await loadLiveCustomer(tx, customerId);
    const count = await tx.address.count({ where: { customerId } });
    // The first address is always the default; nothing else makes sense.
    const isDefault = values.isDefault || count === 0;
    if (isDefault) await clearDefaults(tx, customerId, values.type);
    const address = await tx.address.create({
      data: { ...values, phone: normalisePhoneValue(values.phone), isDefault, customerId },
      select: ADDRESS_SELECT,
    });
    await writeAudit(tx, {
      actor,
      action: "customer.address_create",
      entityType: "customer",
      entityId: customerId,
      entityLabel: label(customer),
      summary: `Added ${values.type.toLowerCase()} address in ${values.city} for ${label(customer)}.`,
      diff: diffOf(null, { ...values, isDefault }),
      ip: options.ip,
    });
    return address;
  });
}

export async function updateAddress(
  customerId: string,
  addressId: string,
  patch: Partial<AddressValues>,
  actor: CustomerActor,
  options: Options = {},
): Promise<AddressRecord> {
  return db.$transaction(async (tx) => {
    const customer = await loadLiveCustomer(tx, customerId);
    const before = await tx.address.findFirst({ where: { id: addressId, customerId }, select: ADDRESS_SELECT });
    if (!before) throw notFound("Address");
    const type = (patch.type ?? before.type) as AddressType;
    if (patch.isDefault) await clearDefaults(tx, customerId, type, addressId);
    const after = await tx.address.update({
      where: { id: addressId },
      data: { ...patch, ...(patch.phone !== undefined ? { phone: normalisePhoneValue(patch.phone) } : {}) },
      select: ADDRESS_SELECT,
    });
    const diff = diffOf(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
    if (diff) {
      await writeAudit(tx, {
        actor,
        action: "customer.address_update",
        entityType: "customer",
        entityId: customerId,
        entityLabel: label(customer),
        summary: `Updated an address for ${label(customer)}.`,
        diff,
        ip: options.ip,
      });
    }
    return after;
  });
}

export async function deleteAddress(customerId: string, addressId: string, actor: CustomerActor, options: Options = {}): Promise<{ id: string }> {
  return db.$transaction(async (tx) => {
    const customer = await loadLiveCustomer(tx, customerId);
    const address = await tx.address.findFirst({ where: { id: addressId, customerId }, select: ADDRESS_SELECT });
    if (!address) throw notFound("Address");
    await tx.address.delete({ where: { id: addressId } });
    // Never leave the book without a default when other addresses remain.
    if (address.isDefault) {
      const next = await tx.address.findFirst({ where: { customerId }, orderBy: { createdAt: "asc" }, select: { id: true } });
      if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    await writeAudit(tx, {
      actor,
      action: "customer.address_delete",
      entityType: "customer",
      entityId: customerId,
      entityLabel: label(customer),
      summary: `Removed the ${address.type.toLowerCase()} address in ${address.city} for ${label(customer)}.`,
      diff: diffOf(address as unknown as Record<string, unknown>, null),
      ip: options.ip,
    });
    return { id: addressId };
  });
}

// ---------------------------------------------------------------------------
// Password reset (E7)
// ---------------------------------------------------------------------------

/**
 * Admin-triggered reset: mint a token, store only its hash, and email the
 * customer a storefront link. The plaintext token exists in the email alone -
 * the return value deliberately omits it so an operator can never hijack an
 * account by "helpfully" pasting the link. Older unused tokens are dropped so
 * exactly one live link exists per customer.
 */
export async function requestCustomerPasswordReset(
  id: string,
  actor: CustomerActor,
  options: Options = {},
): Promise<{ expiresAt: Date; emailQueued: boolean }> {
  const baseUrl = await storefrontBaseUrl();
  return db.$transaction(async (tx) => {
    const customer = await loadLiveCustomer(tx, id);
    if (customer.status === "BLOCKED") throw badRequest("Unblock the customer before sending a password reset.");

    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + CUSTOMER_RESET_TTL_MINUTES * 60_000);
    await tx.customerPasswordResetToken.deleteMany({ where: { customerId: id, usedAt: null } });
    await tx.customerPasswordResetToken.create({ data: { customerId: id, tokenHash: hashToken(token), expiresAt } });

    const email = await emitEvent(
      "customer.password_reset",
      {
        customerId: id,
        customerName: customer.fullName ?? customer.email,
        customerEmail: customer.email,
        resetUrl: `${baseUrl}/reset-password/${token}`,
        expiresMinutes: CUSTOMER_RESET_TTL_MINUTES,
      },
      tx,
    );

    await writeAudit(tx, {
      actor,
      action: "customer.password_reset_request",
      entityType: "customer",
      entityId: id,
      entityLabel: label(customer),
      summary: `Sent a password reset link to ${customer.email} (expires in ${CUSTOMER_RESET_TTL_MINUTES} min).`,
      ip: options.ip,
    });
    return { expiresAt, emailQueued: Boolean(email.email?.queued) };
  });
}

// ---------------------------------------------------------------------------
// Soft delete (E7, D3-like)
// ---------------------------------------------------------------------------

/**
 * Anonymise rather than delete: orders, reviews and returns keep their own
 * snapshots and their FK (SetNull would lose the "same person" link across
 * their history). Everything that is a live credential or a private list -
 * sessions, reset tokens, wishlist, carts, addresses - goes.
 */
export async function softDeleteCustomer(id: string, actor: CustomerActor, options: Options = {}): Promise<CustomerCore> {
  return db.$transaction(async (tx) => {
    const before = await loadLiveCustomer(tx, id);
    const openOrders = await tx.order.count({
      where: { customerId: id, status: { in: ["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY"] } },
    });
    if (openOrders > 0) throw conflict(`This customer has ${openOrders} open order(s). Complete or cancel them before deleting.`);

    const patch = anonymisePatch({ customerId: id, email: before.email, hashEmail: hashToken });
    const after = await tx.customer.update({ where: { id }, data: patch, select: CUSTOMER_CORE_SELECT });
    await revokeCustomerSessions(tx, id, patch.deletedAt);
    await tx.customerPasswordResetToken.deleteMany({ where: { customerId: id } });
    await tx.wishlist.deleteMany({ where: { customerId: id } });
    await tx.cart.deleteMany({ where: { customerId: id } });
    await tx.address.deleteMany({ where: { customerId: id } });

    await writeAudit(tx, {
      actor,
      action: "customer.delete",
      entityType: "customer",
      entityId: id,
      entityLabel: label(before),
      summary: `Soft-deleted customer ${label(before)}${options.reason ? `: ${options.reason}` : "."}`,
      diff: { email: { from: before.email, to: after.email }, phone: { from: before.phone, to: null }, reason: options.reason ?? null },
      ip: options.ip,
    });
    return after;
  });
}

// ---------------------------------------------------------------------------
// Counters (C7) - exported for the ORDERS module
// ---------------------------------------------------------------------------

/** Orders that never became a sale do not count towards lifetime value. */
const NON_COUNTING_ORDER_STATUSES = ["CANCELLED", "FAILED"] as const;

/**
 * Recompute `orderCount`, `totalSpentPaise` (net of refunds), `firstOrderAt`
 * and `lastOrderAt` from the Order table inside the caller's transaction.
 * Recompute-from-source rather than increment: an increment that runs twice
 * (retry, replay) lies forever, a recompute is idempotent by construction.
 * The ORDERS module calls this after every placement, cancellation, delivery
 * and refund.
 */
export async function recomputeCustomerCounters(
  tx: Tx,
  customerId: string,
): Promise<{ orderCount: number; totalSpentPaise: number; firstOrderAt: Date | null; lastOrderAt: Date | null }> {
  const aggregate = await tx.order.aggregate({
    where: { customerId, status: { notIn: [...NON_COUNTING_ORDER_STATUSES] } },
    _count: { _all: true },
    _sum: { totalPaise: true, refundedPaise: true },
    _min: { placedAt: true },
    _max: { placedAt: true },
  });
  const counters = {
    orderCount: aggregate._count._all,
    totalSpentPaise: Math.max(0, (aggregate._sum.totalPaise ?? 0) - (aggregate._sum.refundedPaise ?? 0)),
    firstOrderAt: aggregate._min.placedAt ?? null,
    lastOrderAt: aggregate._max.placedAt ?? null,
  };
  await tx.customer.update({ where: { id: customerId }, data: counters });
  return counters;
}

// ---------------------------------------------------------------------------
// Bulk (11.33: <= 500 ids, one tx, summary)
// ---------------------------------------------------------------------------

export type BulkResult = {
  op: BulkRequest["op"];
  requested: number;
  affected: number;
  skipped: Array<{ id: string; reason: string }>;
  summary: string;
};

export async function bulkCustomers(input: BulkRequest, actor: CustomerActor, options: Options = {}): Promise<BulkResult> {
  const ids = [...new Set(input.ids)];
  return db.$transaction(async (tx) => {
    const rows = await tx.customer.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, fullName: true, status: true, tags: true, deletedAt: true } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const skipped: BulkResult["skipped"] = [];
    let affected = 0;

    for (const id of ids) {
      const row = byId.get(id);
      if (!row) {
        skipped.push({ id, reason: "Not found." });
        continue;
      }
      if (row.deletedAt) {
        skipped.push({ id, reason: "Deleted customers are read-only." });
        continue;
      }
      switch (input.op) {
        case "BLOCK":
        case "UNBLOCK": {
          const target = input.op === "BLOCK" ? "BLOCKED" : "ACTIVE";
          if (row.status === target) {
            skipped.push({ id, reason: `Already ${target.toLowerCase()}.` });
            break;
          }
          await tx.customer.update({ where: { id }, data: { status: target } });
          if (target === "BLOCKED") await revokeCustomerSessions(tx, id);
          affected += 1;
          break;
        }
        case "ADD_TAG":
        case "REMOVE_TAG": {
          const [tag] = normaliseTags([input.tag ?? ""]);
          const has = row.tags.includes(tag);
          if (input.op === "ADD_TAG" ? has : !has) {
            skipped.push({ id, reason: has ? "Already tagged." : "Not tagged." });
            break;
          }
          const tags = input.op === "ADD_TAG" ? normaliseTags([...row.tags, tag]) : row.tags.filter((item) => item !== tag);
          await tx.customer.update({ where: { id }, data: { tags } });
          affected += 1;
          break;
        }
      }
    }

    const summary = `${input.op.replace("_", " ").toLowerCase()}: ${affected} of ${ids.length} customer(s) updated${skipped.length ? `, ${skipped.length} skipped` : ""}.`;
    await writeAudit(tx, {
      actor,
      action: `customer.bulk_${input.op.toLowerCase()}`,
      entityType: "customer",
      summary: `Bulk ${summary}`,
      diff: { op: input.op, tag: input.tag ?? null, reason: input.reason ?? null, requested: ids.length, affected, skipped: skipped.length },
      ip: options.ip,
    });
    return { op: input.op, requested: ids.length, affected, skipped, summary };
  });
}
