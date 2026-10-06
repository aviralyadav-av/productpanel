import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildImportTemplateCsv, MAX_IMPORT_ROWS, parseCsv, parseImportCsv } from "./csv";

/**
 * Run with: node --import tsx --test src/features/inventory/csv.test.ts
 * The parser feeds the bulk stock update (§1 Inventory, §11.33); a quoting
 * bug here would silently misread an operator's counts.
 */

describe("parseCsv (RFC 4180)", () => {
  it("splits fields and records, tolerating CRLF and a trailing newline", () => {
    assert.deepEqual(parseCsv("a,b,c\r\n1,2,3\r\n"), [
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("keeps commas and newlines inside quoted fields and unescapes doubled quotes", () => {
    const rows = parseCsv('sku,note\nSKU-1,"Counted, then ""recounted""\nby two people"\n');
    assert.deepEqual(rows, [
      ["sku", "note"],
      ["SKU-1", 'Counted, then "recounted"\nby two people'],
    ]);
  });

  it("ignores a UTF-8 BOM and blank lines", () => {
    assert.deepEqual(parseCsv("﻿sku\n\nSKU-1\n\n"), [["sku"], ["SKU-1"]]);
  });

  it("returns the final record when the file has no trailing newline", () => {
    assert.deepEqual(parseCsv("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
  });

  it("preserves empty fields", () => {
    assert.deepEqual(parseCsv("a,,c\n,,\n"), [["a", "", "c"], ["", "", ""]]);
  });
});

describe("parseImportCsv", () => {
  it("maps columns by header name in any order and case, ignoring unknown columns", () => {
    const text = "Quantity,my notes,MODE,sku,Reason\n5,ignored,ADD,SKU-1,Delivery\n";
    const parsed = parseImportCsv(text);
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.rows.length, 1);
    assert.deepEqual(parsed.rows[0], {
      line: 2,
      sku: "SKU-1",
      mode: "ADD",
      quantity: "5",
      reason: "Delivery",
      note: "",
      type: "",
    });
  });

  it("reports missing required columns instead of guessing", () => {
    const parsed = parseImportCsv("sku,quantity\nSKU-1,5\n");
    assert.deepEqual(parsed.rows, []);
    assert.match(parsed.errors[0], /"mode"/);
  });

  it("refuses more than the row cap", () => {
    const lines = ["sku,mode,quantity", ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `SKU-${i},add,1`)];
    const parsed = parseImportCsv(lines.join("\n"));
    assert.deepEqual(parsed.rows, []);
    assert.match(parsed.errors[0], /Too many rows/);
  });

  it("treats an empty file as a file-level error", () => {
    assert.deepEqual(parseImportCsv("").errors, ["The file is empty."]);
  });

  it("numbers lines from the file, not from the data (header is line 1)", () => {
    const parsed = parseImportCsv("sku,mode,quantity\nA,add,1\nB,remove,2\n");
    assert.deepEqual(parsed.rows.map((row) => row.line), [2, 3]);
  });
});

describe("buildImportTemplateCsv", () => {
  it("round-trips through the parser with the required columns", () => {
    const parsed = parseImportCsv(buildImportTemplateCsv());
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.rows.length, 3);
    assert.deepEqual(parsed.rows.map((row) => row.mode), ["add", "remove", "set"]);
    assert.equal(parsed.rows[2].note, "Counted 8 Sep");
  });
});
