import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bulkInquirySchema, contactSchema, isHoneypotTripped, parseInquiryFilters } from "@/features/inquiries/schemas";

/**
 * Pure checks for the contact intake (blueprint §5.3 POST /contact, D9):
 * validation, phone normalisation and the honeypot rule.
 */

const valid = { name: "Meera", email: "MEERA@example.com", subject: "Where is my order?", message: "Placed on Monday, no tracking yet." };

describe("contactSchema", () => {
  it("accepts a plain submission and lower-cases the email", () => {
    const parsed = contactSchema.parse(valid);
    assert.equal(parsed.email, "meera@example.com");
    assert.equal(parsed.phone, undefined);
    assert.equal(parsed.type, undefined);
  });

  it("normalises Indian phone numbers and treats blank as absent", () => {
    assert.equal(contactSchema.parse({ ...valid, phone: "98765 43210" }).phone, "+919876543210");
    assert.equal(contactSchema.parse({ ...valid, phone: "" }).phone, undefined);
    assert.equal(contactSchema.safeParse({ ...valid, phone: "12" }).success, false);
  });

  it("rejects short messages, missing subject and unknown types", () => {
    assert.equal(contactSchema.safeParse({ ...valid, message: "hi" }).success, false);
    assert.equal(contactSchema.safeParse({ ...valid, subject: "" }).success, false);
    assert.equal(contactSchema.safeParse({ ...valid, type: "URGENT" }).success, false);
    assert.equal(contactSchema.safeParse({ ...valid, type: "COMPLAINT" }).success, true);
  });

  it("keeps the honeypot value so the service can drop the submission silently", () => {
    assert.equal(isHoneypotTripped(contactSchema.parse(valid)), false);
    assert.equal(isHoneypotTripped(contactSchema.parse({ ...valid, website: "" })), false);
    assert.equal(isHoneypotTripped(contactSchema.parse({ ...valid, website: "   " })), false);
    assert.equal(isHoneypotTripped(contactSchema.parse({ ...valid, website: "http://spam.example" })), true);
  });
});

describe("admin schemas", () => {
  it("bulk assign needs an assignee (null = unassign is allowed)", () => {
    assert.equal(bulkInquirySchema.safeParse({ ids: ["a"], op: "assign" }).success, false);
    assert.equal(bulkInquirySchema.safeParse({ ids: ["a"], op: "assign", assignedToId: null }).success, true);
    assert.equal(bulkInquirySchema.safeParse({ ids: ["a"], op: "resolve" }).success, true);
  });

  it("filters ignore unknown enum values", () => {
    const filters = parseInquiryFilters({ status: "BOGUS", type: "ORDER", priority: "HIGH", assignedTo: "unassigned", from: "2026-09-01" });
    assert.equal(filters.status, undefined);
    assert.equal(filters.type, "ORDER");
    assert.equal(filters.priority, "HIGH");
    assert.equal(filters.assignedTo, "unassigned");
    assert.ok(filters.from instanceof Date);
  });
});
