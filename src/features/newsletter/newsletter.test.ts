import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCsv, parseSubscriberCsv, subscriberCsvTemplate } from "@/features/newsletter/csv";
import {
  addSubscriberSchema,
  bulkSubscribersSchema,
  isHoneypotTripped,
  parseNewsletterFilters,
  subscribeSchema,
} from "@/features/newsletter/schemas";

/**
 * Pure checks for the newsletter module: the CSV parser the import relies on,
 * and the validation rules shared by the public form and the admin dialogs.
 * Run with `npm test` (node --import tsx --test).
 */

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, commas inside cells and CRLF", () => {
    const table = parseCsv('email,name\r\n"a@b.com","Sharma, Asha"\r\nc@d.com,"He said ""hi"""\r\n');
    assert.deepEqual(table, [
      ["email", "name"],
      ["a@b.com", "Sharma, Asha"],
      ["c@d.com", 'He said "hi"'],
    ]);
  });

  it("drops blank lines and a leading BOM", () => {
    assert.deepEqual(parseCsv("﻿a@b.com\n\n\nc@d.com\n"), [["a@b.com"], ["c@d.com"]]);
  });
});

describe("parseSubscriberCsv", () => {
  it("reads a header row in any order or casing", () => {
    const { rows, errors } = parseSubscriberCsv("Name,E-Mail\nAsha,asha@example.com\n");
    assert.deepEqual(errors, []);
    assert.deepEqual(rows, [{ line: 2, email: "asha@example.com", name: "Asha" }]);
  });

  it("accepts a bare column of addresses with no header", () => {
    const { rows, errors } = parseSubscriberCsv("asha@example.com\nravi@example.com\n");
    assert.deepEqual(errors, []);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].email, "asha@example.com");
    assert.equal(rows[0].name, "");
  });

  it("refuses a file whose first cell is neither a header nor an address", () => {
    const { rows, errors } = parseSubscriberCsv("first,second\nAsha,Ravi\n");
    assert.equal(rows.length, 0);
    assert.equal(errors.length, 1);
  });

  it("parses its own template", () => {
    const { rows, errors } = parseSubscriberCsv(subscriberCsvTemplate());
    assert.deepEqual(errors, []);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].name, "Ravi Kumar");
  });
});

describe("subscribeSchema", () => {
  it("normalises the email and treats blank optional fields as null", () => {
    const parsed = subscribeSchema.parse({ email: "  ASHA@Example.com ", name: "", source: "footer" });
    assert.equal(parsed.email, "asha@example.com");
    assert.equal(parsed.name, null);
    assert.equal(parsed.source, "footer");
  });

  it("rejects an invalid address", () => {
    assert.equal(subscribeSchema.safeParse({ email: "not-an-email" }).success, false);
    assert.equal(subscribeSchema.safeParse({ email: "a@b.co" }).success, true);
  });

  it("keeps the honeypot value so the service can drop the submission silently", () => {
    assert.equal(isHoneypotTripped(subscribeSchema.parse({ email: "a@b.co" })), false);
    assert.equal(isHoneypotTripped(subscribeSchema.parse({ email: "a@b.co", website: "  " })), false);
    assert.equal(isHoneypotTripped(subscribeSchema.parse({ email: "a@b.co", website: "http://spam" })), true);
  });
});

describe("admin schemas", () => {
  it("a hand-added subscriber defaults to SUBSCRIBED", () => {
    assert.equal(addSubscriberSchema.parse({ email: "a@b.co" }).status, "SUBSCRIBED");
    assert.equal(addSubscriberSchema.safeParse({ email: "a@b.co", status: "PENDING" }).success, false);
  });

  it("bulk needs at least one id and a known op", () => {
    assert.equal(bulkSubscribersSchema.safeParse({ ids: [], op: "delete" }).success, false);
    assert.equal(bulkSubscribersSchema.safeParse({ ids: ["a"], op: "archive" }).success, false);
    assert.equal(bulkSubscribersSchema.safeParse({ ids: ["a"], op: "unsubscribe" }).success, true);
  });

  it("filters ignore unknown statuses and read the IST day window", () => {
    const filters = parseNewsletterFilters({ status: "BOGUS", source: "footer", from: "2026-09-01", q: " asha " });
    assert.equal(filters.status, undefined);
    assert.equal(filters.source, "footer");
    assert.equal(filters.q, "asha");
    assert.ok(filters.from instanceof Date);
    assert.equal(filters.from?.toISOString(), "2026-08-31T18:30:00.000Z");
  });
});
