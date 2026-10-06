"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { MAX_PINCODE_IMPORT_ROWS, PINCODE_CSV_COLUMNS } from "@/features/shipping/csv";
import type { PincodeImportReport } from "@/features/shipping/pincode-import";
import { MAX_IMPORT_CSV_BYTES } from "@/features/shipping/schemas";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const IMPORT_URL = "/api/admin/shipping/pincodes/import";
export const TEMPLATE_URL = "/api/admin/shipping/pincodes/export?template=1";

type ApiEnvelope = { data?: PincodeImportReport; error?: { message?: string } };

async function postImport(csv: string, dryRun: boolean): Promise<PincodeImportReport> {
  const response = await fetch(`${IMPORT_URL}${dryRun ? "?dryRun=1" : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ csv }),
  });
  const body = (await response.json().catch(() => ({}))) as ApiEnvelope;
  if (!response.ok || !body.data) throw new Error(body.error?.message ?? `Import failed (${response.status}).`);
  return body.data;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" | "warning" }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-muted-foreground text-[11px] uppercase tracking-wide">{label}</p>
      <p data-numeric className={`text-base font-semibold ${tone === "danger" && value > 0 ? "text-destructive" : tone === "warning" && value > 0 ? "text-warning" : ""}`}>
        {value.toLocaleString("en-IN")}
      </p>
    </div>
  );
}

/**
 * Two-step import: the file is validated on the server first (dry run) and
 * the operator sees exactly what would be created, updated and rejected
 * before anything is written. Rejected rows never block the good ones - a
 * courier's 40k-row file with three typos should still import 39,997 rows.
 */
export function PincodeImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [csv, setCsv] = React.useState<string | null>(null);
  const [filename, setFilename] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<PincodeImportReport | null>(null);
  const [busy, setBusy] = React.useState<"validate" | "apply" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setReport(null);
    setError(null);
    if (!file) return;
    if (file.size > MAX_IMPORT_CSV_BYTES) {
      setError("That file is larger than 6 MB. Split it and import in parts.");
      return;
    }
    const text = await file.text();
    setCsv(text);
    setFilename(file.name);
    setBusy("validate");
    try {
      setReport(await postImport(text, true));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Validation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!csv) return;
    setBusy("apply");
    setError(null);
    try {
      const result = await postImport(csv, false);
      toast.success(`Imported ${result.created.toLocaleString("en-IN")} new and updated ${result.updated.toLocaleString("en-IN")} pincodes.`);
      router.refresh();
      onOpenChange(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Import failed.");
    } finally {
      setBusy(null);
    }
  }

  const canApply = Boolean(report && !busy && report.fileErrors.length === 0 && report.validRows > 0);

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import pincodes from CSV</DialogTitle>
          <DialogDescription>
            Columns: <code className="font-mono text-[11px]">{PINCODE_CSV_COLUMNS.join(", ")}</code>. Only <code className="font-mono text-[11px]">pincode</code> is required; blank cells leave existing values unchanged. Up to {MAX_PINCODE_IMPORT_ROWS.toLocaleString("en-IN")} rows per file.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy !== null} className="max-w-xs" aria-label="CSV file" />
            <Button asChild variant="ghost" size="sm">
              <a href={TEMPLATE_URL} download>
                <Download /> Template
              </a>
            </Button>
            {busy === "validate" ? (
              <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                <Loader2 className="size-3 animate-spin" /> Validating…
              </span>
            ) : null}
          </div>

          {error ? <p className="text-destructive text-xs">{error}</p> : null}

          {report ? (
            <div className="space-y-3">
              {report.fileErrors.length > 0 ? (
                <ul className="text-destructive list-disc space-y-1 pl-4 text-xs">
                  {report.fileErrors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              ) : null}

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Rows" value={report.totalRows} />
                <Stat label="Will create" value={report.toCreate} />
                <Stat label="Will update" value={report.toUpdate} />
                <Stat label="Rejected" value={report.invalidRows} tone="danger" />
              </div>
              {report.duplicates > 0 ? (
                <p className="text-muted-foreground text-xs">{report.duplicates} duplicate pincode{report.duplicates === 1 ? "" : "s"} inside the file; the last row for each wins.</p>
              ) : null}
              {report.zonesUsed.length > 0 ? <p className="text-muted-foreground text-xs">Zones referenced: {report.zonesUsed.join(", ")}.</p> : null}

              {report.errors.length > 0 ? (
                <div className="max-h-48 overflow-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 text-muted-foreground sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium">Line</th>
                        <th className="px-2 py-1 text-left font-medium">Pincode</th>
                        <th className="px-2 py-1 text-left font-medium">Problem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {report.errors.map((row) => (
                        <tr key={`${row.line}-${row.pincode}`}>
                          <td className="px-2 py-1 font-mono" data-numeric>{row.line}</td>
                          <td className="px-2 py-1 font-mono">{row.pincode || "—"}</td>
                          <td className="px-2 py-1">{row.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {report.invalidRows > report.errors.length ? (
                    <p className="text-muted-foreground border-t px-2 py-1 text-[11px]">Showing the first {report.errors.length} of {report.invalidRows} problems.</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy !== null}>
            Cancel
          </Button>
          <Button size="sm" onClick={apply} disabled={!canApply}>
            {busy === "apply" ? <Loader2 className="animate-spin" /> : <FileUp />}
            {report ? `Import ${report.validRows.toLocaleString("en-IN")} rows${filename ? ` from ${filename}` : ""}` : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
