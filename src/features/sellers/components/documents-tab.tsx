"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, FileText, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";

import { SELLER_DOCUMENT_TYPES, SELLER_DOCUMENT_TYPE_META, type SellerDocumentType } from "@/lib/enums";
import { formatIstDate, formatIstDateTime } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PermissionGate } from "@/components/shared/permission-gate";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { useActionToast } from "@/components/shared/use-action-toast";

import { reviewDocumentAction } from "@/features/sellers/actions";
import { DocumentStatusBadge, documentTypeLabel } from "@/features/sellers/components/badges";
import { SELLER_DOCUMENT_MAX_BYTES } from "@/features/sellers/schemas";
import type { SellerDocumentRow } from "@/features/sellers/types";

/**
 * KYC documents tab (C5, D6). Files are PRIVATE, so "View file" opens the
 * audited admin route in a new tab - never a storage URL. Uploads on the
 * seller's behalf go to the multipart REST route because Server Actions cap
 * body size and cannot report progress.
 */
export function DocumentsTab({ sellerId, rows }: { sellerId: string; rows: SellerDocumentRow[] }) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();

  async function verify(row: SellerDocumentRow) {
    const result = await confirm({
      title: `Verify ${documentTypeLabel(row.type)}?`,
      description: "Confirms the document matches the seller's details. A verified document is one of the two activation conditions.",
      confirmLabel: "Verify",
      requireReason: { label: "Note (optional, kept on the document)", placeholder: "e.g. Checked against the GST portal" },
    });
    if (!result.ok) return;
    await run(() => reviewDocumentAction({ sellerId, documentId: row.id, status: "VERIFIED", note: result.reason }), {
      onSuccess: () => router.refresh(),
    });
  }

  async function reject(row: SellerDocumentRow) {
    const result = await confirm({
      title: `Reject ${documentTypeLabel(row.type)}?`,
      description: "Tell the seller what is wrong so they can upload a corrected file.",
      confirmLabel: "Reject document",
      destructive: true,
      requireReason: { label: "What is wrong with it?" },
    });
    if (!result.ok) return;
    await run(() => reviewDocumentAction({ sellerId, documentId: row.id, status: "REJECTED", note: result.reason }), {
      onSuccess: () => router.refresh(),
    });
  }

  const table = (
    <DataTable>
      <DataTableHead>
        <Th>Type</Th>
        <Th>Label</Th>
        <Th>File</Th>
        <Th>Status</Th>
        <Th>Uploaded</Th>
        <Th>Reviewed</Th>
        <Th>Note</Th>
        <Th align="right">
          <span className="sr-only">Actions</span>
        </Th>
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.id}>
            <Td className="text-xs font-medium">{documentTypeLabel(row.type)}</Td>
            <Td className="text-xs">{row.label ?? "—"}</Td>
            <Td>
              <FileLink row={row} />
            </Td>
            <Td>
              <DocumentStatusBadge status={row.status} />
            </Td>
            <Td numeric className="text-xs">
              {formatIstDate(new Date(row.uploadedAt))}
            </Td>
            <Td className="text-xs">
              {row.reviewedAt ? (
                <>
                  <span className="block">{row.reviewedBy ?? "—"}</span>
                  <span className="text-muted-foreground block text-[11px]">{formatIstDateTime(new Date(row.reviewedAt))}</span>
                </>
              ) : (
                <span className="text-muted-foreground/70">—</span>
              )}
            </Td>
            <Td className="text-muted-foreground max-w-[16rem] truncate text-xs" >{row.note ?? "—"}</Td>
            <Td align="right">
              <ReviewButtons row={row} pending={pending} onVerify={verify} onReject={reject} />
            </Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = rows.map((row) => (
    <MobileCard key={row.id} title={documentTypeLabel(row.type)} subtitle={row.label ?? undefined} meta={<DocumentStatusBadge status={row.status} />}>
      <MobileCardField label="Uploaded">{formatIstDate(new Date(row.uploadedAt))}</MobileCardField>
      <MobileCardField label="File">
        <FileLink row={row} />
      </MobileCardField>
      <div className="col-span-2 mt-1 flex gap-2">
        <ReviewButtons row={row} pending={pending} onVerify={verify} onReject={reject} />
      </div>
    </MobileCard>
  ));

  return (
    <div className="space-y-3">
      <PermissionGate require="sellers.edit">
        <UploadOnBehalf sellerId={sellerId} />
      </PermissionGate>
      <div className="surface overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No documents yet"
            description="The seller has not submitted KYC files. Upload on their behalf above, or wait for their registration documents."
          />
        ) : (
          <ResponsiveTable table={table} cards={cards} />
        )}
      </div>
      {confirmDialog}
    </div>
  );
}

function FileLink({ row }: { row: SellerDocumentRow }) {
  if (!row.fileUrl) return <span className="text-muted-foreground/70 text-xs">No file</span>;
  return (
    <a
      href={row.fileUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs hover:underline"
      title={row.filename ?? undefined}
    >
      View file
      <ExternalLink className="size-3" />
      {row.sizeBytes ? <span className="text-muted-foreground">({Math.max(1, Math.round(row.sizeBytes / 1024))} KB)</span> : null}
    </a>
  );
}

function ReviewButtons({
  row,
  pending,
  onVerify,
  onReject,
}: {
  row: SellerDocumentRow;
  pending: boolean;
  onVerify: (row: SellerDocumentRow) => Promise<void>;
  onReject: (row: SellerDocumentRow) => Promise<void>;
}) {
  return (
    <PermissionGate require="sellers.approve">
      <div className="inline-flex items-center gap-1">
        {row.status !== "VERIFIED" ? (
          <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => void onVerify(row)}>
            <CheckCircle2 />
            Verify
          </Button>
        ) : null}
        {row.status !== "REJECTED" ? (
          <Button type="button" size="xs" variant="ghost" className="text-destructive" disabled={pending} onClick={() => void onReject(row)}>
            <XCircle />
            Reject
          </Button>
        ) : null}
      </div>
    </PermissionGate>
  );
}

function UploadOnBehalf({ sellerId }: { sellerId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [type, setType] = React.useState<SellerDocumentType>("PAN");
  const [label, setLabel] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return setError("Choose a PDF, JPEG or PNG file.");
    if (file.size > SELLER_DOCUMENT_MAX_BYTES) return setError("The file is larger than 5 MB.");
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("type", type);
      if (label.trim()) body.set("label", label.trim());
      const response = await fetch(`/api/admin/sellers/${sellerId}/documents`, { method: "POST", body });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message ?? `Upload failed (${response.status}).`);
      }
      toast.success("Document uploaded and awaiting verification.");
      setOpen(false);
      setFile(null);
      setLabel("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex justify-end">
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Upload />
        Upload on behalf
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Upload a KYC document</DialogTitle>
              <DialogDescription>Stored privately; only admins with seller access can open it. PDF, JPEG or PNG up to 5 MB.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="doc-type" className="text-xs">
                Document type
              </Label>
              <select
                id="doc-type"
                className="border-input bg-background h-8 w-full rounded-md border px-2 text-sm shadow-xs"
                value={type}
                onChange={(event) => setType(event.target.value as SellerDocumentType)}
              >
                {SELLER_DOCUMENT_TYPES.map((item) => (
                  <option key={item} value={item}>
                    {SELLER_DOCUMENT_TYPE_META[item].label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-label" className="text-xs">
                Label (optional)
              </Label>
              <Input id="doc-label" value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. GST certificate 2026" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-file" className="text-xs">
                File
              </Label>
              <Input id="doc-file" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </div>
            {error ? <p className="text-destructive text-xs">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy || !file}>
                {busy ? "Uploading…" : "Upload"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

