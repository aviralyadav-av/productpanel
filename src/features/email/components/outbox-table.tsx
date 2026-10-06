"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { ExternalLink, RefreshCw } from "lucide-react";

import { formatIstDateTime } from "@/lib/dates";
import { EMAIL_OUTBOX_STATUS_META } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DataTable, DataTableBody, DataTableHead, Td, Tr } from "@/components/shared/data-table";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { HtmlPreview } from "@/components/shared/html-preview";
import { KeyValueList } from "@/components/shared/key-value-list";
import { PermissionGate } from "@/components/shared/permission-gate";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { SortableTh } from "@/components/shared/sortable-th";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";
import { useQueryNav } from "@/hooks/use-query-nav";

import { resendOutboxEmailAction } from "@/features/email/actions";
import {
  outboxEntityHref,
  type OutboxDetailView,
  type OutboxListRow,
} from "@/features/email/templates-schemas";

/**
 * The outbox tab: every email the platform has queued, with the row detail an
 * operator actually needs when a customer says "I never got it" - the exact
 * HTML that was rendered, the attempt count, the SMTP error, and the entity
 * it belongs to.
 *
 * Bodies are stored per row rather than re-rendered from the template, so
 * this shows what was really sent, even after the template has been edited.
 */

export function OutboxStatusBadge({ status }: { status: OutboxListRow["status"] }) {
  const meta = EMAIL_OUTBOX_STATUS_META[status];
  return <StatusPill label={meta?.label ?? status} tone={meta?.tone ?? "neutral"} />;
}

export function OutboxTable({
  rows,
  sort,
  order,
}: {
  rows: OutboxListRow[];
  sort: string;
  order: "asc" | "desc";
}) {
  const { hrefFor } = useQueryNav();

  const table = (
    <DataTable>
      <DataTableHead>
        <SortableTh column="createdAt" label="Queued" currentSort={sort} currentOrder={order} />
        <SortableTh column="toEmail" label="Recipient" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <SortableTh column="subject" label="Subject" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <SortableTh column="templateKey" label="Template" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <SortableTh column="status" label="Status" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <SortableTh column="attempts" label="Tries" currentSort={sort} currentOrder={order} align="right" />
        <SortableTh column="sentAt" label="Sent" currentSort={sort} currentOrder={order} />
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.id}>
            <Td>
              <Link href={hrefFor({ email: row.id }) as Route} className="text-xs hover:underline" scroll={false}>
                {formatIstDateTime(new Date(row.createdAt))}
              </Link>
            </Td>
            <Td>
              <span className="text-sm">{row.toName ?? row.toEmail}</span>
              {row.toName ? <span className="text-muted-foreground block text-[11px]">{row.toEmail}</span> : null}
            </Td>
            <Td>
              <Link href={hrefFor({ email: row.id }) as Route} className="line-clamp-1 text-sm hover:underline" scroll={false}>
                {row.subject}
              </Link>
              {row.lastError ? (
                <span className="text-destructive line-clamp-1 text-[11px]">{row.lastError}</span>
              ) : null}
            </Td>
            <Td>
              {row.templateKey ? (
                <code className="bg-muted rounded px-1 py-0.5 text-[11px]">{row.templateKey}</code>
              ) : (
                <span className="text-muted-foreground text-[11px]">raw</span>
              )}
            </Td>
            <Td>
              <OutboxStatusBadge status={row.status} />
            </Td>
            <Td align="right" numeric>
              {row.attempts}
            </Td>
            <Td>
              <span className="text-muted-foreground text-xs">
                {row.sentAt ? formatIstDateTime(new Date(row.sentAt)) : "—"}
              </span>
            </Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = rows.map((row) => (
    <MobileCard
      key={row.id}
      title={row.subject}
      subtitle={row.toEmail}
      href={hrefFor({ email: row.id })}
      meta={<OutboxStatusBadge status={row.status} />}
    >
      <MobileCardField label="Template">{row.templateKey ?? "raw"}</MobileCardField>
      <MobileCardField label="Tries" numeric>
        {row.attempts}
      </MobileCardField>
      <MobileCardField label="Queued">{formatIstDateTime(new Date(row.createdAt))}</MobileCardField>
      <MobileCardField label="Sent">{row.sentAt ? formatIstDateTime(new Date(row.sentAt)) : "—"}</MobileCardField>
    </MobileCard>
  ));

  return <ResponsiveTable table={table} cards={cards} />;
}

/** Secondary filters for the outbox: template key and the day range. */
export function OutboxFilterBar({ templateKeys }: { templateKeys: string[] }) {
  const { navigate, searchParams } = useQueryNav();
  const templateKey = searchParams.get("templateKey") ?? "";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Filter by template"
        className="border-input bg-background focus-visible:ring-ring/50 h-8 rounded-md border px-2 text-xs shadow-xs outline-none focus-visible:ring-[3px]"
        value={templateKey}
        onChange={(event) => navigate({ templateKey: event.target.value || null })}
      >
        <option value="">All templates</option>
        {templateKeys.map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>
      <DateRangePicker fallback="30d" />
    </div>
  );
}

/** `?email=<id>` opens one row over the list; closing drops the param. */
export function OutboxDetailSheet({ email }: { email: OutboxDetailView | null }) {
  const router = useRouter();
  const { navigate } = useQueryNav();
  const { pending, run } = useActionToast();

  function close() {
    navigate({ email: null });
  }

  if (!email) return null;

  const entityHref = outboxEntityHref(email.entityType, email.entityId);

  return (
    <Sheet open onOpenChange={(open) => (!open ? close() : undefined)}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="border-b">
          <div className="flex items-start justify-between gap-3 pr-6">
            <div className="min-w-0">
              <SheetTitle className="text-sm">{email.subject}</SheetTitle>
              <p className="text-muted-foreground mt-0.5 text-xs">
                To {email.toName ? `${email.toName} <${email.toEmail}>` : email.toEmail}
              </p>
            </div>
            <OutboxStatusBadge status={email.status} />
          </div>
        </SheetHeader>

        <div className="space-y-4 p-4">
          <KeyValueList
            columns={2}
            items={[
              { label: "Template", value: email.templateKey ?? "raw (built in code)" },
              { label: "Attempts", value: email.attempts, numeric: true },
              { label: "Queued", value: formatIstDateTime(new Date(email.createdAt)) },
              { label: "Scheduled", value: formatIstDateTime(new Date(email.scheduledAt)) },
              { label: "Sent", value: email.sentAt ? formatIstDateTime(new Date(email.sentAt)) : "—" },
              { label: "Provider id", value: email.providerMessageId ?? "—" },
              {
                label: "Entity",
                value: entityHref ? (
                  <Link href={entityHref as Route} className="text-brand inline-flex items-center gap-1 hover:underline">
                    {email.entityType} <ExternalLink className="size-3" />
                  </Link>
                ) : (
                  (email.entityType ?? "—")
                ),
              },
              { label: "Dedupe key", value: email.dedupeKey ?? "—", wide: true },
            ]}
          />

          {email.lastError ? (
            <div className="border-destructive/40 bg-destructive/5 rounded-md border p-3">
              <p className="text-destructive text-xs font-medium">Last error</p>
              <p className="text-muted-foreground mt-1 font-mono text-[11px] break-words">{email.lastError}</p>
            </div>
          ) : null}

          <Separator />

          <div>
            <h3 className="mb-2 text-xs font-semibold">Rendered HTML</h3>
            <HtmlPreview html={email.htmlBody} title="Sent email" minHeight={320} />
          </div>

          {email.textBody ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold">Plain text</h3>
              <pre className="bg-muted/40 max-h-64 overflow-auto rounded-md border p-3 font-mono text-[11px] whitespace-pre-wrap">
                {email.textBody}
              </pre>
            </div>
          ) : null}

          <PermissionGate require="jobs.manage">
            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <p className="text-muted-foreground text-[11px]">
                Resending puts this exact body back in the queue; the worker delivers it on its next poll.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending || email.status === "SENDING"}
                onClick={() =>
                  void run(() => resendOutboxEmailAction(email.id), { onSuccess: () => router.refresh() })
                }
              >
                <RefreshCw /> Resend
              </Button>
            </div>
          </PermissionGate>
        </div>
      </SheetContent>
    </Sheet>
  );
}
