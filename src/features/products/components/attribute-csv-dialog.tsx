"use client";

import * as React from "react";
import { Download, FileUp, Upload } from "lucide-react";

import { FormRow } from "@/components/shared/form-layout";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

import { attributeImportAction } from "@/features/products/editor-actions";
import type { ImportReport } from "@/features/products/attribute-csv";
import { CategorySelect } from "@/features/products/components/category-select";
import type { CategoryOption } from "@/features/products/queries";

/**
 * Attribute CSV round trip (blueprint A7): pick a category, download the
 * template/export, upload the edited file, read the validation report, apply.
 * The report is shown BEFORE anything is written because a spreadsheet edit
 * can silently rename a value ("Red" → "red ") and the operator should see
 * the unknown values, not discover them as missing filters later.
 */
export function AttributeCsvDialog({ categories, trigger }: { categories: CategoryOption[]; trigger?: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [categoryId, setCategoryId] = React.useState<string | null>(null);
  const [csv, setCsv] = React.useState<string | null>(null);
  const [filename, setFilename] = React.useState<string | null>(null);
  const [createValues, setCreateValues] = React.useState(false);
  const [report, setReport] = React.useState<ImportReport | null>(null);
  const { pending, run } = useActionToast();

  const reset = () => {
    setCsv(null);
    setFilename(null);
    setReport(null);
  };

  const preview = async (apply: boolean) => {
    if (!categoryId || !csv) return;
    await run(() => attributeImportAction({ categoryId, csv, createValues, apply }), {
      silent: !apply,
      onSuccess: (data) => setReport(data),
    });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setCsv(await file.text());
    setFilename(file.name);
    setReport(null);
  };

  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger ?? <Button type="button" variant="outline" size="sm"><FileUp /> Attribute CSV</Button>}</span>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Attribute values by CSV</DialogTitle>
            <DialogDescription>
              One row per product, one column per attribute code of the chosen category. Select values are matched by value or label; use | between
              multiple values. Blank cells leave the product unchanged.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <FormRow label="Category" required>
              <CategorySelect
                categories={categories}
                value={categoryId}
                onChange={(value) => {
                  setCategoryId(value);
                  reset();
                }}
                placeholder="Choose a category"
                allowClear={false}
              />
            </FormRow>

            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm" disabled={!categoryId}>
                <a href={categoryId ? `/api/admin/products/attributes/export?category=${encodeURIComponent(categoryId)}` : undefined} download>
                  <Download /> Download template / export
                </a>
              </Button>
              <label className="inline-flex">
                <input type="file" accept=".csv,text/csv" className="sr-only" disabled={!categoryId} onChange={(event) => void onFile(event.target.files?.[0])} />
                <span className="bg-background hover:bg-accent inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border px-2.5 text-[0.8rem] font-medium">
                  <Upload className="size-3.5" /> {filename ?? "Upload CSV"}
                </span>
              </label>
              <label className="text-muted-foreground ml-auto flex items-center gap-2 text-xs">
                <Switch checked={createValues} onCheckedChange={setCreateValues} /> Create unknown values
              </label>
            </div>

            {report ? <ReportView report={report} /> : null}
          </div>

          <DialogFooter>
            {!report || report.applied ? (
              <Button type="button" size="sm" disabled={!categoryId || !csv || pending} onClick={() => void preview(false)}>
                {pending ? "Validating" : "Validate"}
              </Button>
            ) : (
              <>
                <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void preview(false)}>
                  Re-validate
                </Button>
                <Button type="button" size="sm" disabled={pending || report.errorCount > 0 || report.changeCount === 0} onClick={() => void preview(true)}>
                  {pending ? "Applying" : `Apply ${report.changeCount} change(s)`}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReportView({ report }: { report: ImportReport }) {
  const problemRows = report.rows.filter((row) => row.errors.length > 0);
  return (
    <div className="space-y-3 rounded-lg border p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill label={report.applied ? "Applied" : "Validated"} tone={report.applied ? "success" : "info"} />
        <span>{report.rows.length} row(s)</span>
        <span>· {report.changeCount} change(s)</span>
        <span className={report.errorCount > 0 ? "text-destructive font-medium" : ""}>· {report.errorCount} error(s)</span>
        {report.createdValues > 0 ? <span>· {report.createdValues} value(s) created</span> : null}
      </div>
      <p className="text-muted-foreground">
        Columns read: {report.columns.length > 0 ? report.columns.join(", ") : "none"}
        {report.ignoredColumns.length > 0 ? ` · ignored: ${report.ignoredColumns.join(", ")}` : ""}
      </p>
      {report.unknownValues.length > 0 ? (
        <div>
          <p className="font-medium">Unknown values{report.applied ? " (created)" : ""}</p>
          <ul className="text-muted-foreground list-disc pl-4">
            {report.unknownValues.slice(0, 30).map((item) => (
              <li key={`${item.code}:${item.value}`}>
                {item.code}: &quot;{item.value}&quot;
              </li>
            ))}
            {report.unknownValues.length > 30 ? <li>… and {report.unknownValues.length - 30} more</li> : null}
          </ul>
        </div>
      ) : null}
      {problemRows.length > 0 ? (
        <div>
          <p className="text-destructive font-medium">Problems</p>
          <ul className="list-disc pl-4">
            {problemRows.slice(0, 40).flatMap((row) => row.errors.map((error, index) => <li key={`${row.line}-${index}`}>{error}</li>))}
            {problemRows.length > 40 ? <li>… more rows have problems</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
