import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { effectiveBlogStatus } from "./schemas";
import { normalizeGroupName, DEFAULT_FAQ_GROUP } from "@/features/faqs/schemas";

/**
 * The two rules that decide what the STOREFRONT shows, verified without a
 * database because both are pure functions and both are easy to get wrong.
 */

describe("effectiveBlogStatus", () => {
  const now = new Date("2026-09-09T12:00:00.000Z");
  const past = new Date("2026-09-01T00:00:00.000Z");
  const future = new Date("2026-12-01T00:00:00.000Z");

  it("treats a scheduled post whose time has come as published (there is no publish job)", () => {
    assert.equal(effectiveBlogStatus({ status: "SCHEDULED", publishedAt: past }, now), "PUBLISHED");
    assert.equal(effectiveBlogStatus({ status: "SCHEDULED", publishedAt: now }, now), "PUBLISHED");
  });

  it("treats a published post dated in the future as scheduled", () => {
    assert.equal(effectiveBlogStatus({ status: "PUBLISHED", publishedAt: future }, now), "SCHEDULED");
  });

  it("leaves every other combination alone", () => {
    assert.equal(effectiveBlogStatus({ status: "PUBLISHED", publishedAt: past }, now), "PUBLISHED");
    assert.equal(effectiveBlogStatus({ status: "SCHEDULED", publishedAt: future }, now), "SCHEDULED");
    assert.equal(effectiveBlogStatus({ status: "DRAFT", publishedAt: past }, now), "DRAFT");
    assert.equal(effectiveBlogStatus({ status: "ARCHIVED", publishedAt: past }, now), "ARCHIVED");
    assert.equal(effectiveBlogStatus({ status: "SCHEDULED", publishedAt: null }, now), "SCHEDULED");
  });

  it("accepts ISO strings as they arrive from a client component", () => {
    assert.equal(effectiveBlogStatus({ status: "SCHEDULED", publishedAt: past.toISOString() }, now), "PUBLISHED");
  });
});

describe("normalizeGroupName", () => {
  it("collapses whitespace and falls back to the default group", () => {
    assert.equal(normalizeGroupName("  Shipping   and   returns "), "Shipping and returns");
    assert.equal(normalizeGroupName(""), DEFAULT_FAQ_GROUP);
    assert.equal(normalizeGroupName("   "), DEFAULT_FAQ_GROUP);
    assert.equal(normalizeGroupName(null), DEFAULT_FAQ_GROUP);
    assert.equal(normalizeGroupName(undefined), DEFAULT_FAQ_GROUP);
  });

  it("is idempotent, so a rename to the same name is detected as a no-op", () => {
    const once = normalizeGroupName(" Orders  &  payments ");
    assert.equal(normalizeGroupName(once), once);
  });
});
