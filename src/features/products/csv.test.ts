import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { parseCsv, splitMulti, toCsv } from "./csv";

describe("attribute CSV codec", () => {
  it("round-trips quotes, commas and newlines", () => {
    const rows = [
      ["product_id", "title", "colour"],
      ["p1", 'Mug, "large"', "red|blue"],
      ["p2", "Line\nbreak", ""],
    ];
    const parsed = parseCsv(toCsv(rows));
    assert.deepEqual(parsed, rows);
  });

  it("accepts CRLF, LF and a BOM, and drops blank lines", () => {
    assert.deepEqual(parseCsv("﻿a,b\r\n1,2\n\n3,4\r\n"), [["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  it("splits multi-value cells and de-duplicates", () => {
    assert.deepEqual(splitMulti(" red | blue|red|"), ["red", "blue"]);
  });
});
