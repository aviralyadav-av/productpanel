"use client";

import Link from "next/link";
import type { Route } from "next";

import { formatIstDate, formatIstDateTime } from "@/lib/dates";
import { formatNumber } from "@/lib/money";
import { PriceText } from "@/components/shared/price-text";
import { StatusPill } from "@/components/shared/status-badge";

import { statusMeta } from "../schemas";
import type { ReportColumn, ReportRow } from "../types";

/**
 * One cell, rendered from the column's declared `type`. Reports are generic -
 * thirteen of them share one table - so the type is what carries the
 * formatting rules the house style fixes elsewhere: money is paise rendered as
 * rupees, rates are basis points rendered as percentages, statuses are pills
 * with the tone from their *_META table, and every number is tabular so digits
 * line up down the column.
 */

/** Numeric columns are right-aligned; that is what makes a column of figures readable. */
export function isNumericColumn(column: ReportColumn): boolean {
  return column.type === "money" || column.type === "number" || column.type === "percent" || column.type === "bps";
}

export function formatCellText(column: ReportColumn, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (column.type) {
    case "money":
      return formatNumber(Number(value) / 100);
    case "number":
      return formatNumber(Number(value));
    case "percent":
      return `${Number(value).toFixed(1)}%`;
    case "bps":
      return `${(Number(value) / 100).toFixed(2)}%`;
    case "date":
      return formatIstDate(new Date(value as string));
    case "datetime":
      return formatIstDateTime(new Date(value as string));
    case "boolean":
      return value ? "Yes" : "No";
    case "status":
      return column.statusKind ? statusMeta(column.statusKind, value).label : String(value);
    default:
      return String(value);
  }
}

export function ReportCell({ column, row }: { column: ReportColumn; row: ReportRow }) {
  const value = row[column.key];

  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground/70">&mdash;</span>;
  }

  switch (column.type) {
    case "money":
      return <PriceText paise={Number(value)} />;
    case "number":
      return <span data-numeric>{formatNumber(Number(value))}</span>;
    case "percent":
      return <span data-numeric>{Number(value).toFixed(1)}%</span>;
    case "bps":
      return <span data-numeric>{(Number(value) / 100).toFixed(2)}%</span>;
    case "date":
      return <span data-numeric>{formatIstDate(new Date(value as string))}</span>;
    case "datetime":
      return <span data-numeric>{formatIstDateTime(new Date(value as string))}</span>;
    case "boolean":
      return <span>{value ? "Yes" : "No"}</span>;
    case "status": {
      const meta = column.statusKind
        ? statusMeta(column.statusKind, value)
        : { label: String(value), tone: "neutral" as const };
      return <StatusPill label={meta.label} tone={meta.tone} />;
    }
    default:
      return <TextCell column={column} row={row} value={String(value)} />;
  }
}

/**
 * A text cell may carry two extras the report declares: a link to the record
 * the row summarises (`hrefKey`) and a quieter second line (`subtitleKey`,
 * typically a SKU or an email). Both are row fields, so a row without them
 * degrades to plain text rather than rendering an empty link.
 */
function TextCell({ column, row, value }: { column: ReportColumn; row: ReportRow; value: string }) {
  const href = column.hrefKey ? row[column.hrefKey] : undefined;
  const subtitle = column.subtitleKey ? row[column.subtitleKey] : undefined;

  const label =
    typeof href === "string" && href.length > 0 ? (
      <Link href={href as Route} className="hover:text-brand font-medium underline-offset-2 hover:underline">
        {value}
      </Link>
    ) : (
      <span>{value}</span>
    );

  if (!subtitle) return label;
  return (
    <div className="min-w-0">
      <div className="truncate">{label}</div>
      <div className="text-muted-foreground truncate text-[11px]">{String(subtitle)}</div>
    </div>
  );
}
