import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_PINCODE_IMPORT_ROWS,
  csvLine,
  parseBooleanCell,
  parseCsv,
  parsePincodeCsv,
  pincodeCsvTemplate,
  validatePincodeRows,
} from "./csv";

/** Run with: node --import tsx --test src/features/shipping/csv.test.ts */

describe("parseCsv (RFC 4180)", () => {
  it("splits fields, honours quotes, doubled quotes, CRLF and a BOM", () => {
    const text = '﻿a,b,c\r\n1,"two, with comma","say ""hi"""\n"multi\nline",,\r\n';
    assert.deepEqual(parseCsv(text), [
      ["a", "b", "c"],
      ["1", "two, with comma", 'say "hi"'],
      ["multi\nline", "", ""],
    ]);
  });

  it("drops blank lines and tolerates a missing trailing newline", () => {
    assert.deepEqual(parseCsv("x,y\n\n1,2"), [["x", "y"], ["1", "2"]]);
  });

  it("round-trips its own csvLine output", () => {
    const cells = ["110001", 'New "Delhi"', "a,b", "=SUM(1)", ""];
    const [row] = parseCsv(csvLine(cells));
    assert.deepEqual(row, ["110001", 'New "Delhi"', "a,b", "'=SUM(1)", ""]);
  });
});

describe("parsePincodeCsv", () => {
  it("maps header aliases and trims cells", () => {
    const parsed = parsePincodeCsv("PIN Code, City , State,Zone Name,Is Serviceable,COD Available,TAT\n 110001 ,New Delhi,Delhi,North,yes,no,3\n");
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(parsed.columns, ["pincode", "city", "state", "zone", "serviceable", "cod", "estimatedDays"]);
    assert.equal(parsed.rows.length, 1);
    assert.deepEqual(parsed.rows[0], { line: 2, pincode: "110001", city: "New Delhi", state: "Delhi", zone: "North", serviceable: "yes", cod: "no", estimatedDays: "3" });
  });

  it("refuses a file without a pincode column", () => {
    const parsed = parsePincodeCsv("city,state\nPune,MH\n");
    assert.equal(parsed.rows.length, 0);
    assert.match(parsed.errors[0], /must include a "pincode" column/);
  });

  it("refuses more than the row cap", () => {
    const lines = ["pincode"];
    for (let i = 0; i <= MAX_PINCODE_IMPORT_ROWS; i += 1) lines.push(String(100000 + i));
    const parsed = parsePincodeCsv(lines.join("\n"));
    assert.equal(parsed.rows.length, 0);
    assert.match(parsed.errors[0], /limit is/);
  });

  it("parses the template it ships", () => {
    const parsed = parsePincodeCsv(pincodeCsvTemplate());
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.rows.length, 2);
  });
});

describe("parseBooleanCell", () => {
  it("understands yes/no spellings, blank as undefined, garbage as null", () => {
    assert.equal(parseBooleanCell("Yes"), true);
    assert.equal(parseBooleanCell("1"), true);
    assert.equal(parseBooleanCell("N"), false);
    assert.equal(parseBooleanCell("false"), false);
    assert.equal(parseBooleanCell(""), undefined);
    assert.equal(parseBooleanCell("maybe"), null);
  });
});

describe("validatePincodeRows", () => {
  const zones = [
    { id: "z_north", name: "North" },
    { id: "z_default", name: "All India" },
  ];

  it("normalises rows, resolves zones by name or id, canonicalises states, keeps blanks as undefined", () => {
    const parsed = parsePincodeCsv(
      ["pincode,city,state,zone,serviceable,cod,estimatedDays", "110001,New Delhi,NCT of Delhi,North,yes,,3", "400001,Mumbai,,z_default,,no,", "560001,,,,,,"].join("\n"),
    );
    const report = validatePincodeRows(parsed.rows, zones);
    assert.deepEqual(report.errors, []);
    assert.equal(report.duplicates, 0);
    assert.deepEqual(report.rows[0], { line: 2, pincode: "110001", city: "New Delhi", state: "Delhi", zoneId: "z_north", isServiceable: true, estimatedDays: 3 });
    assert.deepEqual(report.rows[1], { line: 3, pincode: "400001", city: "Mumbai", zoneId: "z_default", codAvailable: false });
    assert.deepEqual(report.rows[2], { line: 4, pincode: "560001" });
  });

  it("reports bad pincodes, unknown zones, bad booleans and bad day counts with line numbers", () => {
    const parsed = parsePincodeCsv(["pincode,zone,serviceable,cod,estimatedDays", "12345,,,,", "110001,Nowhere,yes,no,3", "110002,,maybe,no,3", "110003,,yes,no,99"].join("\n"));
    const report = validatePincodeRows(parsed.rows, zones);
    assert.equal(report.rows.length, 0);
    assert.deepEqual(
      report.errors.map((error) => error.line),
      [2, 3, 4, 5],
    );
    assert.match(report.errors[1].message, /Unknown zone "Nowhere"/);
    assert.match(report.errors[2].message, /Serviceable must be yes or no/);
    assert.match(report.errors[3].message, /0 to 60/);
  });

  it("merges duplicates so the later row's filled cells win", () => {
    const parsed = parsePincodeCsv(["pincode,cod", "110001,yes", "110001,no"].join("\n"));
    const report = validatePincodeRows(parsed.rows, zones);
    assert.equal(report.duplicates, 1);
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].codAvailable, false);
  });

  it("clears a zone or estimate with '-' / 'none'", () => {
    const parsed = parsePincodeCsv(["pincode,zone,estimatedDays", "110001,none,-"].join("\n"));
    const report = validatePincodeRows(parsed.rows, zones);
    assert.deepEqual(report.rows[0], { line: 2, pincode: "110001", zoneId: null, estimatedDays: null });
  });
});
