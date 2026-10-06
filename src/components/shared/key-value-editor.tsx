"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Row = { id: number; key: string; value: string };

/**
 * Rows of key/value for free-form maps: product specifications, custom
 * meta fields, header overrides. It edits a list of rows internally (so two
 * rows may briefly share a key while typing, and empty rows can exist) and
 * reports a Record<string,string> with blank keys dropped and the last
 * duplicate winning - the same rule JSON.parse applies.
 *
 * @example
 *   <KeyValueEditor value={specs} onChange={setSpecs} keyPlaceholder="Material" valuePlaceholder="Full-grain leather" />
 */
export function KeyValueEditor({
  value,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  addLabel = "Add row",
  disabled,
  maxRows,
  className,
}: {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
  disabled?: boolean;
  maxRows?: number;
  className?: string;
}) {
  const [rows, setRows] = React.useState<Row[]>(() => rowsFrom(value));

  // Re-seed when the parent replaces the map wholesale (record loaded, reset)
  // and it no longer matches what the rows would produce. Previous-prop-in-
  // state rather than an effect so there is no extra render with stale rows.
  const serialised = JSON.stringify(value);
  const [prevSerialised, setPrevSerialised] = React.useState(serialised);
  if (serialised !== prevSerialised) {
    setPrevSerialised(serialised);
    if (JSON.stringify(toRecord(rows)) !== serialised) setRows(rowsFrom(value));
  }

  function update(next: Row[]) {
    setRows(next);
    const record = toRecord(next);
    setPrevSerialised(JSON.stringify(record));
    onChange(record);
  }

  const canAdd = !disabled && (maxRows === undefined || rows.length < maxRows);

  return (
    <div className={cn("space-y-1.5", className)}>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-xs">No entries yet.</p>
      ) : null}
      {rows.map((row, index) => (
        <div key={row.id} className="grid grid-cols-[1fr_1.5fr_auto] items-center gap-1.5">
          <Input
            value={row.key}
            placeholder={keyPlaceholder}
            disabled={disabled}
            aria-label={`Key ${index + 1}`}
            className="h-8 text-xs"
            onChange={(event) =>
              update(rows.map((r) => (r.id === row.id ? { ...r, key: event.target.value } : r)))
            }
          />
          <Input
            value={row.value}
            placeholder={valuePlaceholder}
            disabled={disabled}
            aria-label={`Value ${index + 1}`}
            className="h-8 text-xs"
            onChange={(event) =>
              update(rows.map((r) => (r.id === row.id ? { ...r, value: event.target.value } : r)))
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={`Remove row ${index + 1}`}
            onClick={() => update(rows.filter((r) => r.id !== row.id))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canAdd}
        onClick={() => update([...rows, { id: ++rowSeq, key: "", value: "" }])}
      >
        <Plus />
        {addLabel}
      </Button>
    </div>
  );
}

// Row ids only need to be unique per mount; a module counter avoids a ref.
let rowSeq = 0;

function rowsFrom(value: Record<string, string>): Row[] {
  return Object.entries(value).map(([key, val]) => ({ id: ++rowSeq, key, value: val }));
}

function toRecord(rows: Row[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) record[key] = row.value;
  }
  return record;
}
