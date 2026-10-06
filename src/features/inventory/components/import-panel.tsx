"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Download, FileUp, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import { IMPORT_CSV_COLUMNS, MAX_IMPORT_ROWS, buildImportTemplateCsv } from "@/features/inventory/csv";
import type { ImportReport, ImportRowReport } from "@/features/inventory/import";
import { formatSigned } from "@/features/inventory/stock-math";
import { MovementTypeBadge } from "@/features/inventory/components/movement-cells";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Panel } from "@/components/shared/panel";
import { StockBadge } from "@/components/shared/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { STOCK_MOVEMENT_META } from "@/lib/enums";

type Phase = "idle" | "previewing" | "previewed" | "applying" | "applied";

/**
 * CSV bulk update: choose a file → the server validates and previews every
 * row (dryRun) → the operator reads the preview → apply in one transaction.
 * The same file is sent both times; the server re-derives every "set" delta
 * under the row lock, so the preview is a forecast, not a contract.
 */
export function ImportPanel({ canAdjust }: { canAdjust: boolean }) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [report, setReport] = React.useState<ImportReport | null>(null);
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [error, setError] = React.useState<string | null>(null);

  async function post(dryRun: boolean): Promise<ImportReport | null> {
    if (!file) return null;
    const body = new FormData();
    body.set("file", file);
    const response = await fetch(`/api/admin/inventory/import${dryRun ? "?dryRun=1" : ""}`, {
      method: "POST",
      body,
      credentials: "same-origin",
    });
    const json = (await response.json().catch(() => null)) as
      | { data: ImportReport }
      | { error: { message: string; details?: Record<string, string> } }
      | null;
    if (!response.ok || !json || !("data" in json)) {
      const message = json && "error" in json ? json.error.message : `Upload failed (${response.status}).`;
      throw new Error(message);
    }
    return json.data;
  }

  async function preview(selected: File) {
    setFile(selected);
    setReport(null);
    setError(null);
    setPhase("previewing");
    try {
      const body = new FormData();
      body.set("file", selected);
      const response = await fetch("/api/admin/inventory/import?dryRun=1", { method: "POST", body, credentials: "same-origin" });
      const json = (await response.json().catch(() => null)) as
        | { data: ImportReport }
        | { error: { message: string } }
        | null;
      if (!response.ok || !json || !("data" in json)) {
        throw new Error(json && "error" in json ? json.error.message : `Upload failed (${response.status}).`);
      }
      setReport(json.data);
      setPhase("previewed");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed.");
      setPhase("idle");
    }
  }

  async function apply() {
    setPhase("applying");
    setError(null);
    try {
      const result = await post(false);
      if (result) {
        setReport(result);
        setPhase("applied");
        toast.success(`Applied ${result.applied?.moved ?? 0} stock movements.`);
        router.refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import failed.");
      setPhase("previewed");
    }
  }

  function reset() {
    setFile(null);
    setReport(null);
    setError(null);
    setPhase("idle");
    if (inputRef.current) inputRef.current.value = "";
  }

  function downloadTemplate() {
    const blob = new Blob([buildImportTemplateCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "stock-import-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const busy = phase === "previewing" || phase === "applying";
  const canApply = canAdjust && phase === "previewed" && report !== null && report.invalid === 0 && report.total > 0;

  return (
    <div className="space-y-4">
      <Panel
        title="Bulk stock update from CSV"
        description={`Columns: ${IMPORT_CSV_COLUMNS.join(", ")} (type optional). Up to ${MAX_IMPORT_ROWS} rows; applied all-or-nothing.`}
        action={
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download />
            Template
          </Button>
        }
      >
        <div className="grid gap-3 text-xs sm:grid-cols-3">
          <Step n={1} title="mode" body="add / remove / set. “set” records a count; the change is derived on the server." />
          <Step n={2} title="quantity" body="Whole units, zero or more. “set 0” empties a shelf; “add 0” is rejected." />
          <Step n={3} title="type" body="PURCHASE, ADJUSTMENT, CORRECTION, DAMAGE or RETURN. Defaults: set → CORRECTION, otherwise ADJUSTMENT." />
        </div>

        <label
          className={cn(
            "mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-center text-xs transition-colors",
            busy ? "opacity-60" : "hover:bg-muted/40",
            !canAdjust && "cursor-not-allowed opacity-60",
          )}
        >
          {busy ? <Loader2 className="text-muted-foreground size-5 animate-spin" /> : <FileUp className="text-muted-foreground size-5" />}
          <span className="font-medium">{file ? file.name : "Choose a CSV file"}</span>
          <span className="text-muted-foreground">
            {canAdjust ? "The file is validated and previewed before anything is applied." : "You need the inventory.adjust permission to import."}
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            disabled={busy || !canAdjust}
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (selected) void preview(selected);
            }}
          />
        </label>

        {error ? (
          <Alert variant="destructive" className="mt-3">
            <CircleAlert />
            <AlertTitle>Import not applied</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </Panel>

      {report ? (
        <Panel
          title={phase === "applied" ? "Applied" : "Preview"}
          description={
            report.fileErrors.length > 0
              ? report.fileErrors.join(" ")
              : `${report.total} rows · ${report.valid} valid · ${report.invalid} with problems · ${report.noop} would not move`
          }
          bodyClassName="p-0"
          action={
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
                Start over
              </Button>
              {phase !== "applied" ? (
                <Button size="sm" onClick={apply} disabled={!canApply || busy}>
                  {phase === "applying" ? <Loader2 className="animate-spin" /> : <Upload />}
                  Apply {report.total} rows
                </Button>
              ) : null}
            </div>
          }
        >
          {phase === "applied" && report.applied ? (
            <div className="text-success flex items-center gap-2 border-b px-4 py-2 text-xs">
              <CheckCircle2 className="size-3.5" />
              {report.applied.moved} moved, {report.applied.unchanged} already at that count. Every change is in the ledger.
            </div>
          ) : null}
          {report.rows.length === 0 ? (
            <EmptyState icon={CircleAlert} title="Nothing to preview" description={report.fileErrors[0]} compact />
          ) : (
            <div className="max-h-[32rem] overflow-auto">
              <DataTable>
                <DataTableHead>
                  <Th width="3rem">Line</Th>
                  <Th>SKU</Th>
                  <Th>Variant</Th>
                  <Th>Change</Th>
                  <Th align="right">On hand</Th>
                  <Th align="right">After</Th>
                  <Th>Result</Th>
                </DataTableHead>
                <DataTableBody>
                  {report.rows.map((row) => (
                    <PreviewRow key={row.line} row={row} />
                  ))}
                </DataTableBody>
              </DataTable>
            </div>
          )}
        </Panel>
      ) : null}
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="bg-muted/40 rounded-md p-3">
      <p className="font-medium">
        <span className="text-muted-foreground mr-1.5">{n}.</span>
        <span className="font-mono">{title}</span>
      </p>
      <p className="text-muted-foreground mt-1 leading-relaxed">{body}</p>
    </div>
  );
}

function PreviewRow({ row }: { row: ImportRowReport }) {
  const bad = row.status === "error";
  return (
    <Tr className={cn(bad && "bg-destructive/5")}>
      <Td numeric className="text-muted-foreground">{row.line}</Td>
      <Td className="font-mono text-xs">{row.sku || <span className="text-muted-foreground">—</span>}</Td>
      <Td className="max-w-[16rem] truncate">{row.variant?.label ?? <span className="text-muted-foreground">—</span>}</Td>
      <Td className="whitespace-nowrap">
        {row.mode ? (
          <span className="inline-flex items-center gap-1.5 text-xs">
            <span className="capitalize">{row.mode}</span>
            <span data-numeric className="font-medium">{row.quantity}</span>
            {row.type ? <MovementTypeBadge type={row.type} /> : null}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </Td>
      <Td numeric align="right">{row.variant ? row.variant.onHand : "—"}</Td>
      <Td numeric align="right">
        {row.nextOnHand !== null ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="font-medium">{row.nextOnHand}</span>
            {row.delta !== null ? (
              <span className={cn("font-mono text-[11px]", row.delta < 0 ? "text-destructive" : row.delta > 0 ? "text-success" : "text-muted-foreground")}>
                {formatSigned(row.delta)}
              </span>
            ) : null}
          </span>
        ) : (
          "—"
        )}
      </Td>
      <Td className="max-w-[20rem]">
        {bad ? (
          <span className="text-destructive flex items-start gap-1 text-xs">
            <CircleAlert className="mt-0.5 size-3 shrink-0" />
            {row.message}
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-1.5 text-xs">
            {row.nextState ? <StockBadge state={row.nextState} /> : null}
            <span className="text-muted-foreground">{row.message ?? (row.type ? STOCK_MOVEMENT_META[row.type].label : "")}</span>
          </span>
        )}
      </Td>
    </Tr>
  );
}
