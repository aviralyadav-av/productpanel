import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SELLER_STATUSES, SELLER_TRANSITIONS, canTransitionSeller, type SellerStatus } from "@/lib/enums";

import {
  GSTIN_PATTERN,
  IFSC_PATTERN,
  PAN_PATTERN,
  bankAccountSchema,
  bulkSellerStatusSchema,
  gstinMatchesPan,
  gstinSchema,
  isValidGstin,
  isValidPan,
  maskGstin,
  maskPan,
  nextSellerStatuses,
  panSchema,
  permissionForTransition,
  registerSellerSchema,
  sellerProfileSchema,
  transitionLabel,
  transitionNeedsReason,
  transitionSellerSchema,
} from "@/features/sellers/schemas";

/**
 * Pure checks for the sellers module: the C5 state machine as encoded in
 * enums.ts and the Indian tax/banking identifier rules the schemas enforce.
 * Run with `npm test` (node --import tsx --test).
 */

describe("seller state machine (C5)", () => {
  const legal: Array<[SellerStatus, SellerStatus]> = [
    ["PENDING", "UNDER_REVIEW"],
    ["PENDING", "REJECTED"],
    ["UNDER_REVIEW", "APPROVED"],
    ["UNDER_REVIEW", "REJECTED"],
    ["APPROVED", "ACTIVE"],
    ["ACTIVE", "SUSPENDED"],
    ["SUSPENDED", "ACTIVE"],
    ["REJECTED", "UNDER_REVIEW"],
  ];

  it("allows exactly the blueprint edges", () => {
    const allowed = new Set(legal.map(([from, to]) => `${from}>${to}`));
    for (const from of SELLER_STATUSES) {
      for (const to of SELLER_STATUSES) {
        assert.equal(canTransitionSeller(from, to), allowed.has(`${from}>${to}`), `${from} -> ${to}`);
      }
    }
  });

  it("never allows a self-transition or a jump straight to ACTIVE from PENDING", () => {
    for (const status of SELLER_STATUSES) assert.equal(canTransitionSeller(status, status), false);
    assert.equal(canTransitionSeller("PENDING", "ACTIVE"), false);
    assert.equal(canTransitionSeller("PENDING", "APPROVED"), false);
    assert.equal(canTransitionSeller("ACTIVE", "REJECTED"), false);
  });

  it("nextSellerStatuses mirrors the transition map", () => {
    for (const from of SELLER_STATUSES) {
      assert.deepEqual([...nextSellerStatuses(from)], [...SELLER_TRANSITIONS[from]]);
    }
  });

  it("requires a reason for REJECTED and SUSPENDED only", () => {
    assert.equal(transitionNeedsReason("REJECTED"), true);
    assert.equal(transitionNeedsReason("SUSPENDED"), true);
    for (const status of ["PENDING", "UNDER_REVIEW", "APPROVED", "ACTIVE"] as SellerStatus[]) {
      assert.equal(transitionNeedsReason(status), false);
    }
    assert.equal(transitionSellerSchema.safeParse({ id: "demo_seller_001", toStatus: "SUSPENDED" }).success, false);
    assert.equal(transitionSellerSchema.safeParse({ id: "demo_seller_001", toStatus: "SUSPENDED", reason: "Fraud" }).success, true);
    assert.equal(transitionSellerSchema.safeParse({ id: "demo_seller_001", toStatus: "APPROVED" }).success, true);
    assert.equal(bulkSellerStatusSchema.safeParse({ ids: ["a"], toStatus: "REJECTED" }).success, false);
    assert.equal(bulkSellerStatusSchema.safeParse({ ids: [], toStatus: "APPROVED" }).success, false);
  });

  it("maps edges to the right permission", () => {
    assert.equal(permissionForTransition("ACTIVE", "SUSPENDED"), "sellers.suspend");
    assert.equal(permissionForTransition("SUSPENDED", "ACTIVE"), "sellers.suspend");
    assert.equal(permissionForTransition("APPROVED", "ACTIVE"), "sellers.approve");
    assert.equal(permissionForTransition("UNDER_REVIEW", "APPROVED"), "sellers.approve");
    assert.equal(permissionForTransition("PENDING", "REJECTED"), "sellers.approve");
  });

  it("labels reinstate and re-review distinctly", () => {
    assert.equal(transitionLabel("SUSPENDED", "ACTIVE"), "Reinstate");
    assert.equal(transitionLabel("APPROVED", "ACTIVE"), "Activate");
    assert.equal(transitionLabel("REJECTED", "UNDER_REVIEW"), "Re-review");
    assert.equal(transitionLabel("PENDING", "UNDER_REVIEW"), "Move to review");
  });
});

describe("GSTIN / PAN / IFSC", () => {
  it("accepts well-formed identifiers", () => {
    assert.equal(GSTIN_PATTERN.test("27AAPFU0939F1ZV"), true);
    assert.equal(isValidGstin(" 27aapfu0939f1zv "), true);
    assert.equal(PAN_PATTERN.test("AAPFU0939F"), true);
    assert.equal(isValidPan("aapfu0939f"), true);
    assert.equal(IFSC_PATTERN.test("HDFC0001234"), true);
    assert.equal(IFSC_PATTERN.test("SBIN0A12345"), true);
  });

  it("rejects malformed identifiers", () => {
    for (const bad of ["27AAPFU0939F1Z", "27AAPFU0939F1ZVV", "2AAAPFU0939F1ZV", "27AAPFU0939F0ZV", "27AAPFU0939F1YV", ""]) {
      assert.equal(GSTIN_PATTERN.test(bad), false, bad);
    }
    for (const bad of ["AAPFU0939", "AAPFU0939FF", "1APFU0939F", "AAPFU09390", ""]) {
      assert.equal(PAN_PATTERN.test(bad), false, bad);
    }
    for (const bad of ["HDFC1001234", "HDF00001234", "hdfc0001234"]) {
      assert.equal(IFSC_PATTERN.test(bad), false, bad);
    }
  });

  it("schemas normalise case and treat blank as null", () => {
    assert.equal(gstinSchema.parse("  27aapfu0939f1zv"), "27AAPFU0939F1ZV");
    assert.equal(gstinSchema.parse(""), null);
    assert.equal(gstinSchema.parse(undefined), null);
    assert.equal(panSchema.parse("aapfu0939f"), "AAPFU0939F");
    assert.equal(panSchema.parse("   "), null);
    assert.equal(gstinSchema.safeParse("nope").success, false);
  });

  it("cross-checks the PAN embedded in the GSTIN", () => {
    assert.equal(gstinMatchesPan("27AAPFU0939F1ZV", "AAPFU0939F"), true);
    assert.equal(gstinMatchesPan("27AAPFU0939F1ZV", "ABCDE1234F"), false);
    const mismatch = sellerProfileSchema.safeParse({
      displayName: "Shop",
      slug: "shop",
      ownerName: "Owner",
      email: "owner@example.com",
      gstin: "27AAPFU0939F1ZV",
      pan: "ABCDE1234F",
    });
    assert.equal(mismatch.success, false);
    if (!mismatch.success) assert.ok(mismatch.error.issues.some((issue) => issue.path[0] === "gstin"));
    const ok = sellerProfileSchema.safeParse({
      displayName: "Shop",
      slug: "shop",
      ownerName: "Owner",
      email: "owner@example.com",
      gstin: "27AAPFU0939F1ZV",
      pan: "AAPFU0939F",
    });
    assert.equal(ok.success, true);
    if (ok.success) assert.equal(ok.data.country, "IN");
  });

  it("masks tax ids for lists", () => {
    assert.equal(maskGstin("27AAPFU0939F1ZV"), "27••••••••••1ZV");
    assert.equal(maskPan("AAPFU0939F"), "••••••939F");
    assert.equal(maskGstin(null), null);
  });
});

describe("bank account and registration schemas", () => {
  it("validates bank details", () => {
    const ok = bankAccountSchema.safeParse({
      accountHolder: "Kalakriti Studio",
      bankName: "HDFC Bank",
      accountNumber: "123456789012",
      ifsc: "hdfc0001234",
      upiId: "kala@hdfcbank",
    });
    assert.equal(ok.success, true);
    if (ok.success) {
      assert.equal(ok.data.ifsc, "HDFC0001234");
      assert.equal(ok.data.isPrimary, false);
    }
    assert.equal(bankAccountSchema.safeParse({ accountHolder: "x", bankName: "y", accountNumber: "12", ifsc: "HDFC0001234" }).success, false);
    assert.equal(bankAccountSchema.safeParse({ accountHolder: "x", bankName: "y", accountNumber: "123456", ifsc: "HDFC0001234", upiId: "bad" }).success, false);
  });

  it("accepts a storefront registration and defaults documents to []", () => {
    const parsed = registerSellerSchema.safeParse({
      ownerName: "Asha Verma",
      displayName: "Asha Crafts",
      email: "asha@example.com",
      phone: "9876543210",
      addressLine1: "12 MG Road",
      city: "Pune",
      state: "Maharashtra",
      pinCode: "411001",
      password: "correct horse battery",
    });
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.deepEqual(parsed.data.documents, []);
      assert.equal(parsed.data.phone, "+919876543210");
    }
    assert.equal(registerSellerSchema.safeParse({ ownerName: "A", displayName: "B", email: "bad", phone: "1", addressLine1: "x", city: "y", state: "z", pinCode: "1" }).success, false);
  });
});
