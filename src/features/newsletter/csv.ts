/**
 * CSV helpers for the subscriber import (pure, client-safe, unit-tested).
 *
 * The import file is deliberately tiny - `email,name` - because that is all a
 * mailing list needs and every export from Mailchimp/Sendinblue/Excel can be
 * cut down to it. The parser is RFC 4180 (quotes, escaped quotes, embedded
 * newlines and CRLF) rather than `split(",")`, because "Sharma, Asha" in a
 * name column is the first row every real file contains.
 */

export const SUBSCRIBER_CSV_COLUMNS = ["email", "name"] as const;

export type RawSubscriberRow = { line: number; email: string; name: string };

/** Split CSV text into cells. Blank trailing lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const input = text.replace(/^﻿/, "");

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}

function headerIndex(header: readonly string[], names: readonly string[]): number {
  const normalized = header.map((cell) => cell.trim().toLowerCase().replace(/[\s_-]+/g, ""));
  for (const name of names) {
    const index = normalized.indexOf(name);
    if (index !== -1) return index;
  }
  return -1;
}

/**
 * Read a subscriber CSV. A header row is optional: a file whose first cell
 * looks like an email address is treated as data, so a pasted column of
 * addresses works without ceremony.
 */
export function parseSubscriberCsv(text: string): { rows: RawSubscriberRow[]; errors: string[] } {
  const errors: string[] = [];
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], errors: ["The file is empty."] };

  const first = table[0];
  const looksLikeHeader = headerIndex(first, ["email", "emailaddress", "e-mail"]) !== -1;

  let emailAt = 0;
  let nameAt = 1;
  let startAt = 0;

  if (looksLikeHeader) {
    emailAt = headerIndex(first, ["email", "emailaddress", "e-mail"]);
    nameAt = headerIndex(first, ["name", "fullname", "firstname", "subscriber"]);
    startAt = 1;
  } else if (!first[0]?.includes("@")) {
    errors.push('No "email" column found. Use a header row `email,name`, or a single column of addresses.');
    return { rows: [], errors };
  }

  const rows: RawSubscriberRow[] = [];
  for (let index = startAt; index < table.length; index += 1) {
    const cells = table[index];
    const email = (cells[emailAt] ?? "").trim();
    const name = nameAt >= 0 ? (cells[nameAt] ?? "").trim() : "";
    rows.push({ line: index + 1, email, name });
  }

  return { rows, errors };
}

export function subscriberCsvTemplate(): string {
  return "email,name\nasha@example.com,Asha Sharma\nravi@example.com,Ravi Kumar\n";
}
