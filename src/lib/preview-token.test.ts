import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { createPreviewToken, verifyPreviewToken, PREVIEW_MAX_TTL_SECONDS } from "./preview-token";

// env.ts reads lazily, so setting these after import (but before any call) works.
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");
process.env.AUTH_SECRET ??= "test-auth-secret";

describe("preview tokens", () => {
  const now = 1_800_000_000_000;

  it("round-trips for the same entity and id", () => {
    const { token, expiresAt } = createPreviewToken({ entity: "product", id: "abc", ttlSeconds: 60, now });
    assert.match(token, /^\d+\.[A-Za-z0-9_-]+$/);
    assert.equal(expiresAt.getTime(), Math.floor(now / 1000) * 1000 + 60_000);
    const result = verifyPreviewToken(token, { entity: "product", id: "abc", now });
    assert.equal(result.ok, true);
  });

  it("is bound to entity and id", () => {
    const { token } = createPreviewToken({ entity: "product", id: "abc", now });
    assert.deepEqual(verifyPreviewToken(token, { entity: "page", id: "abc", now }), {
      ok: false,
      reason: "invalid",
    });
    assert.deepEqual(verifyPreviewToken(token, { entity: "product", id: "abd", now }), {
      ok: false,
      reason: "invalid",
    });
  });

  it("expires and caps the ttl at one hour", () => {
    const { token, expiresAt } = createPreviewToken({ entity: "blog", id: "x", ttlSeconds: 99_999, now });
    assert.equal(expiresAt.getTime() - now, PREVIEW_MAX_TTL_SECONDS * 1000);
    assert.equal(verifyPreviewToken(token, { entity: "blog", id: "x", now: expiresAt.getTime() - 1 }).ok, true);
    assert.deepEqual(verifyPreviewToken(token, { entity: "blog", id: "x", now: expiresAt.getTime() }), {
      ok: false,
      reason: "expired",
    });
  });

  it("rejects garbage without throwing", () => {
    for (const bad of [null, "", "abc", ".sig", "123.", "123.short", "x".repeat(300)]) {
      const result = verifyPreviewToken(bad, { entity: "page", id: "p", now });
      assert.equal(result.ok, false);
    }
  });
});
