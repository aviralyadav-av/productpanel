import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { csvCell, csvLine } from "./csv";
import { cellText, formatIstTimestamp, paiseToDisplayRupees, paiseToPlainRupees, safeFilename } from "./format";
import { exportRows, paginateAll, parseExportFormat } from "./index";

/**
 * Run with: node --import tsx --test src/lib/export/csv.test.ts
 * Covers blueprint D15 (formula injection), G6 (streaming CSV), E4 formats.
 */

describe("csvCell formula-injection quoting (D15)", () => {
  for (const trigger of ["=", "+", "-", "@", "\t", "\r"]) {
    it(`defuses a cell starting with ${JSON.stringify(trigger)}`, () => {
      const cell = csvCell(`${trigger}HYPERLINK("http://evil")`);
      assert.ok(cell.startsWith(`"'${trigger}`), `expected leading apostrophe inside quotes, got ${cell}`);
    });
  }

  it("leaves numeric-typed columns alone so negatives stay numbers", () => {
    assert.equal(csvCell(-150, "money"), "-1.50");
    assert.equal(csvCell(-7, "number"), "-7");
  });

  it("does not touch ordinary text", () => {
    assert.equal(csvCell("Handmade kurta"), "Handmade kurta");
    assert.equal(csvCell("ORD-1001"), "ORD-1001");
  });

  it("quotes and doubles embedded quotes, commas and newlines (RFC 4180)", () => {
    assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');
    assert.equal(csvCell("a,b"), '"a,b"');
    assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  });

  it("renders null/undefined as empty and booleans as Yes/No", () => {
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(undefined, "money"), "");
    assert.equal(csvCell(true, "boolean"), "Yes");
    assert.equal(csvCell(false, "boolean"), "No");
  });

  it("terminates lines with CRLF", () => {
    assert.equal(csvLine(["a", "b"]), "a,b\r\n");
  });
});

describe("format helpers", () => {
  it("converts paise to plain rupees for CSV and a currency string for display", () => {
    assert.equal(paiseToPlainRupees(123456), "1234.56");
    assert.equal(paiseToPlainRupees(5), "0.05");
    assert.equal(paiseToPlainRupees(-5), "-0.05");
    assert.equal(paiseToPlainRupees(100), "1.00");
    const display = paiseToDisplayRupees(123456);
    assert.ok(display.includes("1,234.56"), display);
    assert.ok(display.includes("₹"), display);
  });

  it("formats dates in IST (+05:30) as sortable text", () => {
    assert.equal(formatIstTimestamp(new Date("2026-09-04T08:35:33Z")), "2026-09-04 14:05:33");
    assert.equal(cellText("2026-01-01T00:00:00Z", "date"), "2026-01-01 05:30:00");
    assert.equal(cellText("not a date", "date"), "");
  });

  it("produces a safe download filename", () => {
    assert.equal(safeFilename("../etc/passwd", "csv"), "etc-passwd.csv");
    assert.equal(safeFilename('orders "sep" 2026.xlsx', "csv"), "orders-sep-2026.csv");
    assert.equal(safeFilename("", "xlsx"), "export.xlsx");
  });

  it("parses the format query with CSV as default", () => {
    assert.equal(parseExportFormat("xlsx"), "xlsx");
    assert.equal(parseExportFormat("print"), "print");
    assert.equal(parseExportFormat("pdf"), "csv");
    assert.equal(parseExportFormat(null), "csv");
  });
});

describe("exportRows csv", () => {
  const columns = [
    { key: "orderNumber", label: "Order" },
    { key: "note", label: "Note" },
    { key: "totalPaise", label: "Total", type: "money" as const },
    { key: "placedAt", label: "Placed", type: "date" as const },
  ];

  it("streams a BOM, header, defused rows and reports the row count", async () => {
    let completed = -1;
    const response = await exportRows({
      format: "csv",
      filename: "orders",
      columns,
      rows: [
        { orderNumber: "ORD-1", note: "=1+1", totalPaise: 99900, placedAt: new Date("2026-09-04T08:35:33Z") },
        { orderNumber: "ORD-2", note: "fine", totalPaise: null, placedAt: null },
      ],
      onComplete: (count) => {
        completed = count;
      },
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/csv/);
    assert.match(response.headers.get("content-disposition") ?? "", /filename="orders\.csv"/);

    // Read bytes: Response.text() strips a leading BOM per the Fetch spec.
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "starts with a UTF-8 BOM");
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    const lines = text.slice(1).split("\r\n");
    assert.deepEqual(lines, [
      "Order,Note,Total,Placed",
      `ORD-1,"'=1+1",999.00,2026-09-04 14:05:33`,
      "ORD-2,fine,,",
      "",
    ]);
    assert.equal(completed, 2);
  });

  it("accepts an async iterable and handles many rows across chunks", async () => {
    async function* rows() {
      for (let i = 0; i < 1203; i += 1) yield { orderNumber: `ORD-${i}`, note: "", totalPaise: i, placedAt: null };
    }
    const response = await exportRows({ format: "csv", filename: "many", columns, rows: rows() });
    const text = await response.text();
    const lines = text.split("\r\n").filter(Boolean);
    assert.equal(lines.length, 1204);
    assert.equal(lines[1203], "ORD-1202,,12.02,");
  });
});

describe("exportRows print", () => {
  it("renders a self-contained HTML table with escaped cells and two-decimal money", async () => {
    const response = await exportRows({
      format: "print",
      filename: "orders",
      title: "Orders <Sep>",
      storeName: "DIY Baazar",
      columns: [
        { key: "name", label: "Name" },
        { key: "amount", label: "Amount", type: "money" as const },
      ],
      rows: [{ name: "<script>alert(1)</script>", amount: 150000 }],
    });
    const html = await response.text();
    assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "cell is escaped");
    assert.ok(!html.includes("<script>alert(1)"), "raw script never appears");
    assert.ok(html.includes("1,500.00"), "money rendered with two decimals");
    assert.ok(html.includes("@media print"), "print stylesheet present");
    assert.ok(html.includes("Orders &lt;Sep&gt;"), "title escaped");
  });
});

describe("paginateAll", () => {
  it("pages until a short page and maps rows", async () => {
    const calls: Array<[number, number]> = [];
    const source = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}` }));
    const rows = paginateAll(
      async (skip, take) => {
        calls.push([skip, take]);
        return source.slice(skip, skip + take);
      },
      { pageSize: 3, map: (row) => ({ ...row, upper: row.id.toUpperCase() }) },
    );

    const collected: Record<string, unknown>[] = [];
    for await (const row of rows) collected.push(row);

    assert.equal(collected.length, 7);
    assert.equal(collected[6].upper, "R6");
    assert.deepEqual(calls, [
      [0, 3],
      [3, 3],
      [6, 3],
    ]);
  });

  it("stops after an exact multiple by fetching one empty page", async () => {
    const calls: number[] = [];
    const rows = paginateAll(
      async (skip, take) => {
        calls.push(skip);
        return skip < 6 ? Array.from({ length: take }, (_, i) => ({ id: skip + i }) as Record<string, unknown>) : [];
      },
      { pageSize: 3 },
    );
    const collected: Record<string, unknown>[] = [];
    for await (const row of rows) collected.push(row);
    assert.equal(collected.length, 6);
    assert.deepEqual(calls, [0, 3, 6]);
  });
});
