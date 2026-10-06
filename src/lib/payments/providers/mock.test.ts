import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProviderContext } from "../types";
import {
  MOCK_EVENT_ID_HEADER,
  MOCK_SIGNATURE_HEADER,
  createMockProvider,
  mockOrderId,
  mockPaymentId,
  signMockCallback,
  signMockWebhook,
} from "./mock";

/**
 * Run with: node --import tsx --test src/lib/payments/providers/mock.test.ts
 * The no-secret fallback signs with the platform `payments` HMAC key, which
 * derives from ENCRYPTION_KEY - env.ts reads lazily, so setting it here works.
 */
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");
process.env.AUTH_SECRET ??= "test-auth-secret";

function context(credentials: Record<string, string> = {}): ProviderContext {
  return { code: "MOCK", displayName: "Mock gateway", mode: "TEST", credentials, settings: {}, fetch };
}

const SECRET = "whsec_test_123";

describe("mock provider ids", () => {
  it("derives deterministic provider ids from our order id", () => {
    assert.equal(mockOrderId("order_1"), mockOrderId("order_1"));
    assert.notEqual(mockOrderId("order_1"), mockOrderId("order_2"));
    assert.ok(mockOrderId("order_1").startsWith("mock_order_"));
    assert.ok(mockPaymentId(mockOrderId("order_1")).startsWith("mock_pay_"));
    assert.notEqual(mockPaymentId("x", 1), mockPaymentId("x", 2));
  });

  it("createPayment returns the same providerOrderId every time", async () => {
    const provider = createMockProvider(context({ webhookSecret: SECRET }));
    const input = {
      order: { id: "order_1", orderNumber: "ORD-1001" },
      amountPaise: 149900,
      currency: "INR",
      customer: {},
    };
    const first = await provider.createPayment(input);
    const second = await provider.createPayment(input);
    assert.equal(first.providerOrderId, second.providerOrderId);
    assert.equal(first.clientParams.amountPaise, 149900);
    assert.equal(first.clientParams.provider, "MOCK");
  });
});

describe("mock client callback signature (B6 /verify)", () => {
  const provider = createMockProvider(context({ webhookSecret: SECRET }));
  const providerOrderId = mockOrderId("order_1");
  const providerPaymentId = mockPaymentId(providerOrderId);

  it("accepts a correctly signed callback", async () => {
    const payload = { providerOrderId, providerPaymentId, amountPaise: 149900, currency: "INR" };
    const result = await provider.verifyClientCallback({ ...payload, signature: signMockCallback(payload, SECRET) });
    assert.ok(result.ok);
    assert.equal(result.providerOrderId, providerOrderId);
    assert.equal(result.providerPaymentId, providerPaymentId);
    assert.equal(result.amountPaise, 149900);
    assert.equal(result.currency, "INR");
  });

  it("rejects a tampered amount", async () => {
    const payload = { providerOrderId, providerPaymentId, amountPaise: 149900 };
    const signature = signMockCallback(payload, SECRET);
    const result = await provider.verifyClientCallback({ ...payload, amountPaise: 1, signature });
    assert.deepEqual(result, { ok: false, reason: "signature" });
  });

  it("rejects a callback signed with the wrong secret", async () => {
    const payload = { providerOrderId, providerPaymentId, amountPaise: 149900 };
    const result = await provider.verifyClientCallback({ ...payload, signature: signMockCallback(payload, "other") });
    assert.deepEqual(result, { ok: false, reason: "signature" });
  });

  it("rejects malformed payloads", async () => {
    assert.deepEqual(await provider.verifyClientCallback(null), { ok: false, reason: "malformed" });
    assert.deepEqual(await provider.verifyClientCallback({ providerOrderId }), { ok: false, reason: "malformed" });
    assert.deepEqual(
      await provider.verifyClientCallback({ providerOrderId, providerPaymentId, amountPaise: -1, signature: "x" }),
      { ok: false, reason: "malformed" },
    );
  });

  it("falls back to the platform key when no webhookSecret is configured", async () => {
    const unconfigured = createMockProvider(context());
    const payload = { providerOrderId, providerPaymentId, amountPaise: 500 };
    const ok = await unconfigured.verifyClientCallback({ ...payload, signature: signMockCallback(payload) });
    assert.ok(ok.ok);
    const bad = await unconfigured.verifyClientCallback({ ...payload, signature: signMockCallback(payload, SECRET) });
    assert.deepEqual(bad, { ok: false, reason: "signature" });
  });
});

describe("mock webhook signature (D5)", () => {
  const provider = createMockProvider(context({ webhookSecret: SECRET }));
  const providerOrderId = mockOrderId("order_1");
  const providerPaymentId = mockPaymentId(providerOrderId);
  const body = {
    id: "evt_1",
    type: "payment.succeeded",
    providerOrderId,
    providerPaymentId,
    amountPaise: 149900,
    currency: "INR",
    mode: "TEST",
  };
  const rawBody = JSON.stringify(body);

  it("verifies a signed body and normalises the event", async () => {
    const headers = new Headers({ [MOCK_SIGNATURE_HEADER]: signMockWebhook(rawBody, SECRET) });
    const result = await provider.verifyWebhook({ rawBody, headers });
    assert.ok(result.ok);
    assert.equal(result.event.providerEventId, "evt_1");
    assert.equal(result.event.status, "SUCCEEDED");
    assert.equal(result.event.providerOrderId, providerOrderId);
    assert.equal(result.event.amountPaise, 149900);
    assert.equal(result.event.currency, "INR");
    assert.equal(result.event.mode, "TEST");
  });

  it("maps failure and refund events", async () => {
    for (const [type, status] of [
      ["payment.failed", "FAILED"],
      ["refund.completed", "REFUNDED"],
    ] as const) {
      const raw = JSON.stringify({ ...body, type, failureCode: "BAD_CARD" });
      const result = await provider.verifyWebhook({
        rawBody: raw,
        headers: new Headers({ [MOCK_SIGNATURE_HEADER]: signMockWebhook(raw, SECRET) }),
      });
      assert.ok(result.ok);
      assert.equal(result.event.status, status);
      if (type === "payment.failed") assert.equal(result.event.failureCode, "BAD_CARD");
    }
  });

  it("rejects a missing or wrong signature before parsing", async () => {
    assert.deepEqual(await provider.verifyWebhook({ rawBody, headers: new Headers() }), { ok: false, reason: "signature" });
    const wrong = new Headers({ [MOCK_SIGNATURE_HEADER]: signMockWebhook(rawBody, "other") });
    assert.deepEqual(await provider.verifyWebhook({ rawBody, headers: wrong }), { ok: false, reason: "signature" });
    // A single changed byte in the body invalidates the signature over it.
    const tampered = rawBody.replace("149900", "149901");
    const headers = new Headers({ [MOCK_SIGNATURE_HEADER]: signMockWebhook(rawBody, SECRET) });
    assert.deepEqual(await provider.verifyWebhook({ rawBody: tampered, headers }), { ok: false, reason: "signature" });
  });

  it("rejects malformed or unknown events even when correctly signed", async () => {
    const notJson = "{not json";
    assert.deepEqual(
      await provider.verifyWebhook({
        rawBody: notJson,
        headers: new Headers({ [MOCK_SIGNATURE_HEADER]: signMockWebhook(notJson, SECRET) }),
      }),
      { ok: false, reason: "malformed" },
    );
    const unknown = JSON.stringify({ ...body, type: "something.else" });
    assert.deepEqual(
      await provider.verifyWebhook({
        rawBody: unknown,
        headers: new Headers({ [MOCK_SIGNATURE_HEADER]: signMockWebhook(unknown, SECRET) }),
      }),
      { ok: false, reason: "malformed" },
    );
  });

  it("takes the event id from the header when the body has none", async () => {
    const withoutId: Record<string, unknown> = { ...body };
    delete withoutId.id;
    const raw = JSON.stringify(withoutId);
    const result = await provider.verifyWebhook({
      rawBody: raw,
      headers: new Headers({
        [MOCK_SIGNATURE_HEADER]: signMockWebhook(raw, SECRET),
        [MOCK_EVENT_ID_HEADER]: "evt_hdr",
      }),
    });
    assert.ok(result.ok);
    assert.equal(result.event.providerEventId, "evt_hdr");
  });
});
