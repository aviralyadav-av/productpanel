import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  base32Encode,
  constantTimeEqual,
  decrypt,
  encrypt,
  hashToken,
  hmacSign,
  hmacVerify,
  hotp,
  isEncrypted,
  last4,
  randomToken,
  verifyTotp,
  generateRecoveryCodes,
  hashRecoveryCodes,
  findRecoveryCode,
} from "./crypto";

// env.ts reads lazily, so setting these after import (but before any call) works.
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.AUTH_SECRET ??= "test-auth-secret";

describe("encrypt/decrypt", () => {
  it("round-trips utf8 text", () => {
    const text = "Account 1234 5678 · ₹ रुपये";
    const blob = encrypt(text, "bank");
    assert.equal(isEncrypted(blob), true);
    assert.equal(blob.split(":")[0], "v1");
    assert.equal(decrypt(blob, "bank"), text);
  });

  it("produces a different ciphertext each call (random IV)", () => {
    assert.notEqual(encrypt("same", "2fa"), encrypt("same", "2fa"));
  });

  it("refuses a purpose mismatch and tampering", () => {
    const blob = encrypt("secret", "smtp");
    assert.throws(() => decrypt(blob, "bank"));
    const parts = blob.split(":");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("AA") ? "BB" : "AA");
    assert.throws(() => decrypt(parts.join(":"), "smtp"));
    assert.throws(() => decrypt("v0:a:b:c", "smtp"));
  });
});

describe("tokens", () => {
  it("hashToken is sha256 hex", () => {
    assert.equal(
      hashToken("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("randomToken is url safe and long enough", () => {
    const token = randomToken();
    assert.match(token, /^[A-Za-z0-9_-]+$/);
    assert.ok(token.length >= 43);
  });

  it("constantTimeEqual handles different lengths", () => {
    assert.equal(constantTimeEqual("a", "a"), true);
    assert.equal(constantTimeEqual("a", "ab"), false);
  });
});

describe("hmac", () => {
  it("signs and verifies", () => {
    const sig = hmacSign("preview", "product:abc:123");
    assert.equal(hmacVerify("preview", "product:abc:123", sig), true);
    assert.equal(hmacVerify("preview", "product:abc:124", sig), false);
    assert.equal(hmacVerify("bank", "product:abc:123", sig), false);
    assert.equal(hmacVerify("preview", "product:abc:123", ""), false);
  });
});

describe("totp (RFC 6238 appendix B, SHA-1)", () => {
  // The RFC secret is the ASCII string "12345678901234567890".
  const secret = base32Encode(Buffer.from("12345678901234567890", "ascii"));

  it("encodes the RFC secret to the well-known base32 form", () => {
    assert.equal(secret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  it("matches the published 8-digit vectors", () => {
    assert.equal(hotp(secret, Math.floor(59 / 30), 8), "94287082");
    assert.equal(hotp(secret, Math.floor(1111111109 / 30), 8), "07081804");
    assert.equal(hotp(secret, Math.floor(1234567890 / 30), 8), "89005924");
    assert.equal(hotp(secret, Math.floor(20000000000 / 30), 8), "65353130");
  });

  it("verifies within the window and reports the counter", () => {
    const now = 59 * 1000;
    const result = verifyTotp({ secret, code: "287082", now });
    assert.deepEqual(result, { ok: true, counter: 1 });
    // One step later is still inside ±1.
    assert.equal(verifyTotp({ secret, code: "287082", now: now + 30_000 }).ok, true);
    // Two steps later is outside.
    assert.equal(verifyTotp({ secret, code: "287082", now: now + 60_000 }).ok, false);
    // Replay of an already-used counter is rejected.
    assert.equal(verifyTotp({ secret, code: "287082", now, lastCounter: 1 }).ok, false);
    assert.equal(verifyTotp({ secret, code: "28708", now }).ok, false);
  });
});

describe("recovery codes", () => {
  it("generates, hashes and finds a code once", async () => {
    const codes = generateRecoveryCodes(3);
    assert.equal(codes.length, 3);
    assert.match(codes[0], /^[a-z0-9]{5}-[a-z0-9]{5}$/);
    const hashes = await hashRecoveryCodes(codes);
    assert.equal(await findRecoveryCode(codes[1].toUpperCase(), hashes), 1);
    assert.equal(await findRecoveryCode("zzzzz-zzzzz", hashes), -1);
  });
});

describe("last4", () => {
  it("shows only the tail", () => {
    assert.equal(last4("1234 5678 9012"), "9012");
    assert.equal(last4("12"), "12");
    assert.equal(last4(null), null);
  });
});
