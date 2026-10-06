"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, Upload } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { FormRow } from "@/components/shared/form-layout";
import { useActionToast } from "@/components/shared/use-action-toast";

import { importSubscribersAction } from "@/features/newsletter/actions";
import { subscriberCsvTemplate } from "@/features/newsletter/csv";
import { MAX_IMPORT_CSV_BYTES, MAX_IMPORT_ROWS } from "@/features/newsletter/schemas";
import type { ImportReport, ImportRowReport } from "@/features/newsletter/types";

/**
 * Two-step CSV import: preview first, apply second. The operator never writes
 * anything they have not seen counted, and a file with an invalid row is
 * rejected whole - half an imported list is worse than none.
 */
const ACTION_LABEL: Record<ImportRowReport["action"], string> = {
  create: "Add",
  resubscribe: "Resubscribe",
  update: "Update name",
  skip: "Skip",
  error: "Error",
};

export function ImportSubscribersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { run, pending } = useActionToast();
  const [csv, setCsv] = React.useState("");
  const [source, setSource] = React.useState("import");
  const [report, setReport] = React.useState<ImportReport | null>(null);

  function reset() {
    setCsv("");
    setSource("import");
    setReport(null);
  }

  async function readFile(file: File) {
    if (file.size > MAX_IMPORT_CSV_BYTES) {
      setReport({
        dryRun: true,
        totalRows: 0,
        valid: 0,
        invalid: 0,
        duplicates: 0,
        toCreate: 0,
        toUpdate: 0,
        created: 0,
        updated: 0,
        fileErrors: ["That file is larger than 2 MB. Split it and import in batches."],
        rows: [],
      });
      return;
    }
    setCsv(await file.text());
    setReport(null);
  }

  async function submit(apply: boolean) {
    const result = await run(() => importSubscribersAction({ csv, source, apply }), { silent: !apply });
    if (result.ok) {
      setReport(result.data);
      if (apply && result.data.fileErrors.length === 0) {
        router.refresh();
        onOpenChange(false);
        reset();
      }
    }
  }

  // Apply is only offered after a clean preview, so the numbers on the button
  // are the numbers the operator just read.
  const canApply = report !== null && report.dryRun && report.fileErrors.length === 0 && report.toCreate + report.toUpdate > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import subscribers</DialogTitle>
          <DialogDescription>
            A CSV with an <code className="font-mono">email</code> column and an optional <code className="font-mono">name</code> column, up to{" "}
            {MAX_IMPORT_ROWS.toLocaleString("en-IN")} rows. Existing addresses are left subscribed; unsubscribed ones are reactivated.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="file"
              accept=".csv,text/csv"
              className="h-8 max-w-xs text-xs"
              aria-label="CSV file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setCsv(subscriberCsvTemplate());
                setReport(null);
              }}
            >
              <Download />
              Use the template
            </Button>
          </div>

          <FormRow label="CSV" htmlFor="import-csv" hint="Paste rows here, or pick a file above.">
            <Textarea
              id="import-csv"
              value={csv}
              onChange={(event) => {
                setCsv(event.target.value);
                setReport(null);
              }}
              rows={6}
              className="font-mono text-[11px]"
              placeholder={"email,name\nasha@example.com,Asha Sharma"}
            />
          </FormRow>

          <FormRow label="Source" htmlFor="import-source" hint="Recorded on every imported row.">
            <Input id="import-source" value={source} onChange={(event) => setSource(event.target.value)} maxLength={40} className="max-w-[16rem]" />
          </FormRow>

          {report ? <ImportReportView report={report} /> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="outline" disabled={pending || csv.trim().length === 0} onClick={() => void submit(false)}>
            {pending ? "Checking…" : "Preview"}
          </Button>
          <Button type="button" disabled={pending || !canApply} onClick={() => void submit(true)}>
            {report ? `Import ${report.toCreate + report.toUpdate} row(s)` : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportReportView({ report }: { report: ImportReport }) {
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { label: "Rows", value: report.totalRows },
          { label: "To add", value: report.toCreate },
          { label: "To update", value: report.toUpdate },
          { label: "Duplicates", value: report.duplicates },
          { label: "Invalid", value: report.invalid },
        ].map((item) => (
          <div key={item.label} className="rounded-md border px-2 py-1.5">
            <dt className="text-muted-foreground text-[11px]">{item.label}</dt>
            <dd data-numeric className={cn("text-sm font-semibold", item.label === "Invalid" && item.value > 0 && "text-destructive")}>
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      {report.fileErrors.length > 0 ? (
        <ul className="text-destructive space-y-0.5 text-xs">
          {report.fileErrors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}

      {report.rows.length > 0 ? (
        <div className="max-h-56 overflow-auto rounded-md border">
          <DataTable>
            <DataTableHead>
              <Th width="3rem" align="right">
                Line
              </Th>
              <Th>Email</Th>
              <Th>Name</Th>
              <Th>Action</Th>
            </DataTableHead>
            <DataTableBody>
              {report.rows.map((row) => (
                <Tr key={`${row.line}-${row.email ?? ""}`}>
                  <Td numeric align="right" className="text-[11px]">
                    {row.line}
                  </Td>
                  <Td className="font-mono text-[11px]">{row.email ?? "—"}</Td>
                  <Td className="text-[11px]">{row.name ?? "—"}</Td>
                  <Td className={cn("text-[11px]", row.action === "error" && "text-destructive")}>
                    {ACTION_LABEL[row.action]}
                    {row.message ? <span className="text-muted-foreground"> · {row.message}</span> : null}
                  </Td>
                </Tr>
              ))}
            </DataTableBody>
          </DataTable>
        </div>
      ) : null}
    </div>
  );
}

export function ImportSubscribersButton() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Upload />
        Import CSV
      </Button>
      <ImportSubscribersDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
