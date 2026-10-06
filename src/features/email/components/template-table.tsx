"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { AlertTriangle, Pencil } from "lucide-react";

import { formatIstDate, formatIstDateTime } from "@/lib/dates";
import { formatNumber } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { usePermission } from "@/components/shared/permission-gate";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { SortableTh } from "@/components/shared/sortable-th";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";

import { setEmailTemplateActiveAction } from "@/features/email/actions";
import type { TemplateListRow } from "@/features/email/templates-schemas";

/**
 * The eighteen transactional emails, one row each. The active switch is the
 * only inline write: disabling a template is a routine operational decision
 * ("stop the delivered email while we fix the copy") and forcing a trip
 * through the editor for it would be busywork.
 *
 * "Sent" counts EmailOutbox rows for the key, which is why a template with a
 * disabled switch can still show a large number - history does not disappear.
 */
export function TemplateTable({
  rows,
  sort,
  order,
}: {
  rows: TemplateListRow[];
  sort: string;
  order: "asc" | "desc";
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const canManage = usePermission("email_templates.manage");

  async function toggle(row: TemplateListRow, isActive: boolean) {
    await run(() => setEmailTemplateActiveAction(row.id, isActive), { onSuccess: () => router.refresh() });
  }

  const table = (
    <DataTable>
      <DataTableHead>
        <SortableTh column="name" label="Template" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <SortableTh column="key" label="Key" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <SortableTh column="subject" label="Subject" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <Th align="right">Variables</Th>
        <Th align="right">Sent</Th>
        <SortableTh column="updatedAt" label="Updated" currentSort={sort} currentOrder={order} />
        <Th align="center" width="5rem">
          Active
        </Th>
        <Th width="3rem"><span className="sr-only">Edit</span></Th>
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.id}>
            <Td>
              <Link href={`/admin/email-templates/${row.id}` as Route} className="text-sm font-medium hover:underline">
                {row.name}
              </Link>
              {row.unknownCount > 0 ? (
                <span className="text-warning ml-2 inline-flex items-center gap-1 text-[11px]">
                  <AlertTriangle className="size-3" />
                  {row.unknownCount} unknown variable{row.unknownCount === 1 ? "" : "s"}
                </span>
              ) : null}
            </Td>
            <Td>
              <code className="bg-muted rounded px-1 py-0.5 text-[11px]">{row.key}</code>
            </Td>
            <Td>
              <span className="text-muted-foreground line-clamp-1 text-xs">{row.subject}</span>
            </Td>
            <Td align="right" numeric>
              {formatNumber(row.variableCount)}
            </Td>
            <Td align="right" numeric>
              <span title={row.lastSentAt ? `Last sent ${formatIstDateTime(new Date(row.lastSentAt))}` : "Never sent"}>
                {formatNumber(row.sentCount)}
              </span>
              {row.failedCount > 0 ? (
                <Link
                  href={`/admin/email-templates?tab=outbox&status=FAILED&templateKey=${row.key}` as Route}
                  className="text-destructive ml-1.5 text-[11px] hover:underline"
                >
                  {row.failedCount} failed
                </Link>
              ) : null}
            </Td>
            <Td>
              <span className="text-muted-foreground text-xs">
                {formatIstDate(new Date(row.updatedAt))}
                {row.updatedByName ? ` · ${row.updatedByName}` : ""}
              </span>
            </Td>
            <Td align="center">
              {canManage ? (
                <Switch
                  checked={row.isActive}
                  disabled={pending}
                  aria-label={`${row.isActive ? "Disable" : "Enable"} the ${row.name} email`}
                  onCheckedChange={(value) => void toggle(row, value)}
                />
              ) : (
                <StatusPill label={row.isActive ? "Active" : "Off"} tone={row.isActive ? "success" : "neutral"} />
              )}
            </Td>
            <Td align="right">
              <Button asChild variant="ghost" size="icon-xs" aria-label={`Edit ${row.name}`}>
                <Link href={`/admin/email-templates/${row.id}` as Route}>
                  <Pencil />
                </Link>
              </Button>
            </Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = rows.map((row) => (
    <MobileCard
      key={row.id}
      title={row.name}
      subtitle={row.subject}
      href={`/admin/email-templates/${row.id}`}
      meta={<StatusPill label={row.isActive ? "Active" : "Off"} tone={row.isActive ? "success" : "neutral"} />}
    >
      <MobileCardField label="Key">{row.key}</MobileCardField>
      <MobileCardField label="Sent" numeric>
        {formatNumber(row.sentCount)}
      </MobileCardField>
      <MobileCardField label="Variables" numeric>
        {formatNumber(row.variableCount)}
      </MobileCardField>
      <MobileCardField label="Updated">{formatIstDate(new Date(row.updatedAt))}</MobileCardField>
    </MobileCard>
  ));

  return <ResponsiveTable table={table} cards={cards} />;
}

