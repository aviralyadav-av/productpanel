"use client";

import Link from "next/link";
import type { Route } from "next";
import { EyeOff } from "lucide-react";

import { formatIstDateTime } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CopyButton } from "@/components/shared/copy-button";

import {
  actionLabel,
  actionPrefixOf,
  diffFields,
  entityHref,
  formatDiffValue,
  isRedacted,
  prefixLabel,
  type AuditRow,
} from "@/features/audit/schemas";

/**
 * One audit entry, with its diff as a before/after table.
 *
 * Values the writer redacted (passwords, tokens, encrypted blobs - D4) are
 * shown AS redacted rather than hidden: "this field changed, and you are not
 * allowed to see to what" is a materially different fact from "this field did
 * not change".
 */
export function AuditDetailDialog({
  row,
  onClose,
}: {
  row: AuditRow | null;
  onClose: () => void;
}) {
  const fields = row ? diffFields(row.diff) : [];
  const href = row ? entityHref(row.entityType, row.entityId) : null;
  const snapshotOnly = fields.length > 0 && fields.every((field) => field.from === undefined);

  return (
    <Dialog open={Boolean(row)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {row ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="h-5 font-normal">
                  {prefixLabel(actionPrefixOf(row.action))}
                </Badge>
                {actionLabel(row.action)}
              </DialogTitle>
              <DialogDescription>{row.summary}</DialogDescription>
            </DialogHeader>

            <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
              <Field label="When">{formatIstDateTime(new Date(row.createdAt))}</Field>
              <Field label="Actor">
                {row.actorName ? `${row.actorName} · ${row.actorEmail}` : row.actorEmail}
              </Field>
              <Field label="Action code">
                <code>{row.action}</code>
              </Field>
              <Field label="Entity">
                {href ? (
                  <Link href={href as Route} className="underline underline-offset-2">
                    {row.entityType} · {row.entityLabel ?? row.entityId}
                  </Link>
                ) : (
                  `${row.entityType}${row.entityLabel ? ` · ${row.entityLabel}` : ""}`
                )}
              </Field>
              <Field label="Entity id">
                {row.entityId ? (
                  <span className="inline-flex items-center gap-1">
                    <code className="text-[11px]">{row.entityId}</code>
                    <CopyButton value={row.entityId} label="Copy entity id" size="icon-xs" variant="ghost" />
                  </span>
                ) : (
                  "—"
                )}
              </Field>
              <Field label="IP">{row.ip ?? "—"}</Field>
              {row.userAgent ? (
                <div className="sm:col-span-2">
                  <Field label="Device">
                    <span className="text-muted-foreground break-all">{row.userAgent}</span>
                  </Field>
                </div>
              ) : null}
            </dl>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold">
                {snapshotOnly ? "Recorded values" : "Changes"}
              </h3>

              {fields.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No field-level diff was recorded for this entry.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-2.5 py-1.5 text-left font-medium">Field</th>
                        {!snapshotOnly ? (
                          <th className="px-2.5 py-1.5 text-left font-medium">Before</th>
                        ) : null}
                        <th className="px-2.5 py-1.5 text-left font-medium">
                          {snapshotOnly ? "Value" : "After"}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {fields.map((field) => (
                        <tr key={field.field}>
                          <td className="px-2.5 py-1.5 align-top font-medium">
                            <code className="text-[11px]">{field.field}</code>
                          </td>
                          {!snapshotOnly ? (
                            <td className="text-muted-foreground max-w-xs px-2.5 py-1.5 align-top break-words">
                              <Value value={field.from} />
                            </td>
                          ) : null}
                          <td className="max-w-xs px-2.5 py-1.5 align-top break-words">
                            <Value value={field.to} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground/80 text-[10px] tracking-wide uppercase">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function Value({ value }: { value: unknown }) {
  if (isRedacted(value)) {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1">
        <EyeOff className="size-3" />
        redacted
      </span>
    );
  }
  return <span>{formatDiffValue(value)}</span>;
}
