import type { Prisma } from "@prisma/client";

import type { CustomerSegment } from "@/lib/enums";

/**
 * Pure customer rules (blueprint C7, E7). No database, no Next imports: the
 * list query, the detail badge, the seed and the node:test suite all call the
 * same functions, so "who counts as VIP" is decided in exactly one place.
 */

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

/** Thresholds from settings (`customers.*`, C7). Numbers, never strings. */
export type SegmentThresholds = {
  newDays: number;
  returningMinOrders: number;
  vipMinOrders: number;
  highValueMinSpendPaise: number;
  inactiveDays: number;
};

/** The seeded defaults; `resolveSegmentThresholds()` overrides from settings. */
export const DEFAULT_SEGMENT_THRESHOLDS: SegmentThresholds = {
  newDays: 30,
  returningMinOrders: 2,
  vipMinOrders: 10,
  highValueMinSpendPaise: 2_000_000,
  inactiveDays: 180,
};

/** The columns a segment decision needs - a Customer row satisfies it. */
export type SegmentInput = {
  createdAt: Date;
  orderCount: number;
  totalSpentPaise: number;
  lastOrderAt: Date | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * MS_PER_DAY);
}

/**
 * Every segment a customer belongs to. Segments overlap by design: a VIP who
 * signed up last week is both VIP and NEW, and the list tabs are filters, not
 * partitions. INACTIVE is judged on the last order, falling back to the
 * signup date for customers who never ordered - a two-year-old account with
 * no orders is inactive, not "new".
 */
export function segmentsFor(
  customer: SegmentInput,
  thresholds: SegmentThresholds = DEFAULT_SEGMENT_THRESHOLDS,
  now: Date = new Date(),
): CustomerSegment[] {
  const segments: CustomerSegment[] = [];
  if (customer.orderCount >= thresholds.vipMinOrders) segments.push("VIP");
  if (customer.totalSpentPaise >= thresholds.highValueMinSpendPaise) segments.push("HIGH_VALUE");
  if (customer.orderCount >= thresholds.returningMinOrders) segments.push("RETURNING");
  if (customer.createdAt >= daysAgo(now, thresholds.newDays)) segments.push("NEW");
  const lastActivity = customer.lastOrderAt ?? customer.createdAt;
  if (lastActivity < daysAgo(now, thresholds.inactiveDays)) segments.push("INACTIVE");
  return segments;
}

/**
 * The single badge shown in a table cell. Priority is "most valuable first"
 * so a lapsed VIP still reads as VIP (the operator wants to win them back),
 * while a plain returning customer who lapsed reads as INACTIVE.
 */
const BADGE_PRIORITY: readonly CustomerSegment[] = ["VIP", "HIGH_VALUE", "INACTIVE", "RETURNING", "NEW"];

export function segmentFor(
  customer: SegmentInput,
  thresholds: SegmentThresholds = DEFAULT_SEGMENT_THRESHOLDS,
  now: Date = new Date(),
): CustomerSegment | null {
  const segments = segmentsFor(customer, thresholds, now);
  for (const candidate of BADGE_PRIORITY) if (segments.includes(candidate)) return candidate;
  return null;
}

/**
 * The same rules as `segmentsFor`, expressed as a Prisma filter so the list
 * page filters in the database instead of loading every customer. Keep the
 * two in lockstep - domain.test.ts checks them against each other.
 */
export function segmentWhere(
  segment: CustomerSegment,
  thresholds: SegmentThresholds = DEFAULT_SEGMENT_THRESHOLDS,
  now: Date = new Date(),
): Prisma.CustomerWhereInput {
  switch (segment) {
    case "VIP":
      return { orderCount: { gte: thresholds.vipMinOrders } };
    case "HIGH_VALUE":
      return { totalSpentPaise: { gte: thresholds.highValueMinSpendPaise } };
    case "RETURNING":
      return { orderCount: { gte: thresholds.returningMinOrders } };
    case "NEW":
      return { createdAt: { gte: daysAgo(now, thresholds.newDays) } };
    case "INACTIVE": {
      const cutoff = daysAgo(now, thresholds.inactiveDays);
      return {
        OR: [
          { lastOrderAt: { lt: cutoff } },
          { lastOrderAt: null, createdAt: { lt: cutoff } },
        ],
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Anonymisation (E7, D3-like)
// ---------------------------------------------------------------------------

/** The placeholder address a soft-deleted customer keeps (E7). */
export function anonymisedEmail(customerId: string): string {
  return `deleted+${customerId}@invalid.local`;
}

export function isAnonymisedEmail(email: string): boolean {
  return /^deleted\+[^@]+@invalid\.local$/i.test(email);
}

/**
 * The column patch a soft delete applies. Orders keep their own snapshots so
 * nothing here touches them; the customer row itself loses every direct
 * contact detail and credential but keeps its name and counters so the
 * operator can still read "who was this" in old order history. The original
 * email survives only as a hash, so a re-registration with the same address
 * can be detected without storing it.
 */
export function anonymisePatch(input: {
  customerId: string;
  email: string;
  hashEmail: (normalisedEmail: string) => string;
  now?: Date;
}): {
  email: string;
  deletedEmailHash: string;
  phone: null;
  passwordHash: null;
  acceptsMarketing: false;
  emailVerifiedAt: null;
  deletedAt: Date;
} {
  return {
    email: anonymisedEmail(input.customerId),
    deletedEmailHash: input.hashEmail(normaliseEmail(input.email)),
    phone: null,
    passwordHash: null,
    acceptsMarketing: false,
    emailVerifiedAt: null,
    deletedAt: input.now ?? new Date(),
  };
}

/** Emails are compared case-insensitively everywhere (blueprint 4.5 `email uq`). */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Tags are lower-cased, trimmed, de-duplicated and capped so filters match. */
export function normaliseTags(tags: readonly string[], max = 20): string[] {
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
    if (tag) seen.add(tag);
    if (seen.size >= max) break;
  }
  return [...seen];
}

/**
 * Lifetime value maths shared by the KPI strip and the detail page. Net of
 * refunds because "spent" means money the store kept (C7).
 */
export function averageOrderValue(totalSpentPaise: number, orderCount: number): number {
  return orderCount > 0 ? Math.round(totalSpentPaise / orderCount) : 0;
}
