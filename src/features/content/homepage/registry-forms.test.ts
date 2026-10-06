import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SECTION_REGISTRY,
  emptyBlockPayload,
  blockLabel,
  formValuesToPayload,
  payloadToFormValues,
} from "@/features/content/registry";

/**
 * The generic section editor is only trustworthy if a payload survives a round
 * trip through the form. These cases pin the two shapes that would otherwise
 * silently corrupt data: `featured_products` (numbers and an id LIST edited as
 * one string) and `announcement_bar` (a repeatable type whose blocks the
 * editor builds from `emptyBlockPayload`).
 *
 * Static imports only - `npm test` compiles these as CommonJS.
 */

const featured = SECTION_REGISTRY.featured_products;
const announcement = SECTION_REGISTRY.announcement_bar;

test("featured_products: payload -> form values -> payload keeps ids, order and numbers", () => {
  const payload = { source: "manual", productIds: ["demo_prod_007", "demo_prod_044"], categoryId: null, limit: 12 };

  const values = payloadToFormValues(featured.fields, payload);
  // Lists are edited as one comma-separated string; numbers as text.
  assert.equal(values.productIds, "demo_prod_007, demo_prod_044");
  assert.equal(values.limit, "12");
  assert.equal(values.categoryId, "");

  const roundTripped = formValuesToPayload(featured.fields, values);
  assert.deepEqual(roundTripped.productIds, ["demo_prod_007", "demo_prod_044"]);
  assert.equal(roundTripped.limit, 12);
  // An empty entity field must become null, not the empty string, so the
  // "no category" case is stored the way the resolver expects it.
  assert.equal(roundTripped.categoryId, null);

  const parsed = featured.sectionSchema.parse(roundTripped);
  assert.deepEqual(parsed, { source: "manual", productIds: ["demo_prod_007", "demo_prod_044"], categoryId: null, limit: 12 });
});

test("featured_products: a blank number field falls back to the schema default rather than zero", () => {
  const values = payloadToFormValues(featured.fields, { source: "auto", productIds: [], categoryId: null, limit: 8 });
  values.limit = "";

  const payload = formValuesToPayload(featured.fields, values);
  assert.equal("limit" in payload, false, "an empty limit must not be written as 0");

  const parsed = featured.sectionSchema.parse(payload) as { limit: number };
  assert.equal(parsed.limit, 8);
});

test("announcement_bar: section and block payloads both survive the round trip", () => {
  const sectionValues = payloadToFormValues(announcement.fields, { rotateSeconds: 7 });
  assert.equal(sectionValues.rotateSeconds, "7");
  assert.deepEqual(announcement.sectionSchema.parse(formValuesToPayload(announcement.fields, sectionValues)), {
    rotateSeconds: 7,
  });

  const block = { text: "Free shipping above ₹999", linkUrl: "/shipping-policy" };
  const blockValues = payloadToFormValues(announcement.blockFields, block);
  const roundTripped = formValuesToPayload(announcement.blockFields, blockValues);
  assert.deepEqual(roundTripped, block);
  assert.deepEqual(announcement.blockSchema.parse(roundTripped), block);
});

test("announcement_bar: a new block starts empty and is labelled by its position until filled in", () => {
  const empty = emptyBlockPayload(announcement);
  assert.deepEqual(empty, { text: "", linkUrl: "" });
  assert.equal(blockLabel(announcement, empty, 2), "message 3");
  assert.equal(blockLabel(announcement, { text: "Diwali sale  live now" }, 0), "Diwali sale live now");

  // A blank required field must be rejected by the registry schema, which is
  // what the service validates against before writing.
  assert.equal(announcement.blockSchema.safeParse(empty).success, false);
});
