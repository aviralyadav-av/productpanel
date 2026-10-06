import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
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
  type SegmentInput,
} from "./domain";

const NOW = new Date("2026-09-08T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

function customer(overrides: Partial<SegmentInput> = {}): SegmentInput {
  return { createdAt: daysAgo(400), orderCount: 0, totalSpentPaise: 0, lastOrderAt: null, ...overrides };
}

describe("segmentsFor", () => {
  it("marks a fresh signup NEW and nothing else", () => {
    assert.deepEqual(segmentsFor(customer({ createdAt: daysAgo(3) }), DEFAULT_SEGMENT_THRESHOLDS, NOW), ["NEW"]);
  });

  it("treats the new-days boundary inclusively", () => {
    assert.ok(segmentsFor(customer({ createdAt: daysAgo(30) }), DEFAULT_SEGMENT_THRESHOLDS, NOW).includes("NEW"));
    assert.ok(!segmentsFor(customer({ createdAt: daysAgo(31) }), DEFAULT_SEGMENT_THRESHOLDS, NOW).includes("NEW"));
  });

  it("returns RETURNING from the second order and VIP from the tenth", () => {
    const two = customer({ orderCount: 2, lastOrderAt: daysAgo(5) });
    const ten = customer({ orderCount: 10, lastOrderAt: daysAgo(5) });
    assert.deepEqual(segmentsFor(two, DEFAULT_SEGMENT_THRESHOLDS, NOW), ["RETURNING"]);
    assert.deepEqual(segmentsFor(ten, DEFAULT_SEGMENT_THRESHOLDS, NOW), ["VIP", "RETURNING"]);
  });

  it("flags HIGH_VALUE on spend alone", () => {
    const whale = customer({ orderCount: 1, totalSpentPaise: 2_000_000, lastOrderAt: daysAgo(10) });
    assert.deepEqual(segmentsFor(whale, DEFAULT_SEGMENT_THRESHOLDS, NOW), ["HIGH_VALUE"]);
  });

  it("judges INACTIVE on the last order, falling back to signup when there are none", () => {
    assert.ok(segmentsFor(customer({ orderCount: 3, lastOrderAt: daysAgo(181) }), DEFAULT_SEGMENT_THRESHOLDS, NOW).includes("INACTIVE"));
    assert.ok(!segmentsFor(customer({ orderCount: 3, lastOrderAt: daysAgo(179) }), DEFAULT_SEGMENT_THRESHOLDS, NOW).includes("INACTIVE"));
    assert.ok(segmentsFor(customer({ createdAt: daysAgo(200) }), DEFAULT_SEGMENT_THRESHOLDS, NOW).includes("INACTIVE"));
    assert.ok(!segmentsFor(customer({ createdAt: daysAgo(100) }), DEFAULT_SEGMENT_THRESHOLDS, NOW).includes("INACTIVE"));
  });

  it("honours custom thresholds", () => {
    const thresholds = { ...DEFAULT_SEGMENT_THRESHOLDS, vipMinOrders: 3, highValueMinSpendPaise: 50_000 };
    const row = customer({ orderCount: 3, totalSpentPaise: 60_000, lastOrderAt: daysAgo(1) });
    assert.deepEqual(segmentsFor(row, thresholds, NOW), ["VIP", "HIGH_VALUE", "RETURNING"]);
  });
});

describe("segmentFor (primary badge)", () => {
  it("prefers VIP, then HIGH_VALUE, then INACTIVE, then RETURNING, then NEW", () => {
    assert.equal(segmentFor(customer({ orderCount: 12, totalSpentPaise: 9_000_000, lastOrderAt: daysAgo(400) }), DEFAULT_SEGMENT_THRESHOLDS, NOW), "VIP");
    assert.equal(segmentFor(customer({ orderCount: 1, totalSpentPaise: 9_000_000, lastOrderAt: daysAgo(400) }), DEFAULT_SEGMENT_THRESHOLDS, NOW), "HIGH_VALUE");
    assert.equal(segmentFor(customer({ orderCount: 3, lastOrderAt: daysAgo(400) }), DEFAULT_SEGMENT_THRESHOLDS, NOW), "INACTIVE");
    assert.equal(segmentFor(customer({ orderCount: 3, lastOrderAt: daysAgo(4) }), DEFAULT_SEGMENT_THRESHOLDS, NOW), "RETURNING");
    assert.equal(segmentFor(customer({ createdAt: daysAgo(2) }), DEFAULT_SEGMENT_THRESHOLDS, NOW), "NEW");
  });

  it("is null for an ordinary one-time buyer", () => {
    assert.equal(segmentFor(customer({ orderCount: 1, totalSpentPaise: 50_000, lastOrderAt: daysAgo(40) }), DEFAULT_SEGMENT_THRESHOLDS, NOW), null);
  });
});

describe("segmentWhere agrees with segmentsFor", () => {
  /** A tiny evaluator for the subset of Prisma where-syntax the domain emits. */
  function matches(where: Record<string, unknown>, row: SegmentInput): boolean {
    return Object.entries(where).every(([key, condition]) => {
      if (key === "OR") return (condition as Record<string, unknown>[]).some((branch) => matches(branch, row));
      const value = row[key as keyof SegmentInput];
      if (condition === null) return value === null;
      const ops = condition as Record<string, Date | number>;
      if ("gte" in ops) return value !== null && (value as number | Date) >= ops.gte;
      if ("lt" in ops) return value !== null && (value as number | Date) < ops.lt;
      throw new Error(`unsupported condition ${JSON.stringify(condition)}`);
    });
  }

  const fixtures: SegmentInput[] = [
    customer({ createdAt: daysAgo(1) }),
    customer({ createdAt: daysAgo(45), orderCount: 1, totalSpentPaise: 120_000, lastOrderAt: daysAgo(20) }),
    customer({ createdAt: daysAgo(500), orderCount: 4, totalSpentPaise: 900_000, lastOrderAt: daysAgo(200) }),
    customer({ createdAt: daysAgo(900), orderCount: 15, totalSpentPaise: 3_500_000, lastOrderAt: daysAgo(2) }),
    customer({ createdAt: daysAgo(300) }),
    customer({ createdAt: daysAgo(10), orderCount: 2, totalSpentPaise: 2_000_000, lastOrderAt: daysAgo(1) }),
  ];

  for (const segment of ["NEW", "RETURNING", "VIP", "HIGH_VALUE", "INACTIVE"] as const) {
    it(`for ${segment}`, () => {
      const where = segmentWhere(segment, DEFAULT_SEGMENT_THRESHOLDS, NOW) as Record<string, unknown>;
      for (const row of fixtures) {
        const expected = segmentsFor(row, DEFAULT_SEGMENT_THRESHOLDS, NOW).includes(segment);
        assert.equal(matches(where, row), expected, `${segment} for ${JSON.stringify(row)}`);
      }
    });
  }
});

describe("anonymisation (E7)", () => {
  it("builds the placeholder email from the id and recognises it", () => {
    assert.equal(anonymisedEmail("ckabc123"), "deleted+ckabc123@invalid.local");
    assert.ok(isAnonymisedEmail("deleted+ckabc123@invalid.local"));
    assert.ok(!isAnonymisedEmail("asha@example.com"));
  });

  it("clears every contact detail and credential, keeps a hash of the normalised email", () => {
    const now = new Date("2026-09-08T12:00:00.000Z");
    const patch = anonymisePatch({ customerId: "c1", email: "  Asha@Example.COM ", hashEmail: (value) => `hash(${value})`, now });
    assert.deepEqual(patch, {
      email: "deleted+c1@invalid.local",
      deletedEmailHash: "hash(asha@example.com)",
      phone: null,
      passwordHash: null,
      acceptsMarketing: false,
      emailVerifiedAt: null,
      deletedAt: now,
    });
  });

  it("never keeps the original email anywhere in the patch", () => {
    const patch = anonymisePatch({ customerId: "c2", email: "someone@example.com", hashEmail: () => "h" });
    assert.ok(!JSON.stringify(patch).includes("someone@example.com"));
  });
});

describe("normalisers", () => {
  it("lower-cases and trims emails", () => {
    assert.equal(normaliseEmail("  Ravi.K@Example.com "), "ravi.k@example.com");
  });

  it("lower-cases, trims, de-duplicates and caps tags", () => {
    assert.deepEqual(normaliseTags([" VIP", "vip", "Wholesale  Buyer", "", "  "]), ["vip", "wholesale buyer"]);
    assert.equal(normaliseTags(Array.from({ length: 30 }, (_, i) => `t${i}`)).length, 20);
  });

  it("average order value rounds and survives zero orders", () => {
    assert.equal(averageOrderValue(0, 0), 0);
    assert.equal(averageOrderValue(100_001, 3), 33334);
  });
});
