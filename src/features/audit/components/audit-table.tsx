"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { ExternalLink } from "lucide-react";

import { formatIstDateTime } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { SortableTh } from "@/components/shared/sortable-th";

import { AuditDetailDialog } from "@/features/audit/components/audit-detail-dialog";
import {
  actionLabel,
  actionPrefixOf,
  entityHref,
  prefixLabel,
  type AuditRow,
} from "@/features/audit/schemas";

/**
 * The audit table. Rows open a dialog with the before/after diff rather than a
 * detail page: an audit entry has no life of its own, it is a fact about
 * something else, and the link to that something else is right there in the
 * row.
 */
export function AuditTable({
  rows,
  sort,
  order,
}: {
  rows: AuditRow[];
  sort: string;
  order: "asc" | "desc";
}) {
  const [selected, setSelected] = React.useState<AuditRow | null>(null);

  const table = (
    <DataTable>
      <DataTableHead>
        <SortableTh column="createdAt" label="When (IST)" currentSort={sort} currentOrder={order} />
        <SortableTh column="actor" label="Actor" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <SortableTh column="action" label="Action" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <SortableTh column="entityType" label="Entity" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <Th>Summary</Th>
        <Th>IP</Th>
        <Th width="4rem">
          <span className="sr-only">Details</span>
        </Th>
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.id} onClick={() => setSelected(row)} className="cursor-pointer">
            <Td numeric className="text-xs whitespace-nowrap">
              {formatIstDateTime(new Date(row.createdAt))}
            </Td>
            <Td className="max-w-56 truncate text-xs">
              {row.actorName ? (
                <>
                  <span className="font-medium">{row.actorName}</span>
                  <span className="text-muted-foreground"> · {row.actorEmail}</span>
                </>
              ) : (
                row.actorEmail
              )}
            </Td>
            <Td className="text-xs">
              <Badge variant="outline" className="h-5 font-normal">
                {prefixLabel(actionPrefixOf(row.action))}
              </Badge>
              <span className="ml-1.5">{actionLabel(row.action)}</span>
            </Td>
            <Td className="max-w-56 truncate text-xs">
              <EntityCell row={row} />
            </Td>
            <Td className="text-muted-foreground max-w-md truncate text-xs">{row.summary}</Td>
            <Td className="text-muted-foreground text-xs">{row.ip ?? "—"}</Td>
            <Td align="right">
              {/* The row itself is clickable, but a real button is what makes
                  the diff reachable from the keyboard. */}
              <Button
                variant="ghost"
                size="xs"
                onClick={(event) => {
                  event.stopPropagation();
                  setSelected(row);
                }}
              >
                Details
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
      title={`${prefixLabel(actionPrefixOf(row.action))} · ${actionLabel(row.action)}`}
      subtitle={row.summary}
      meta={
        <button
          type="button"
          onClick={() => setSelected(row)}
          className="text-xs underline underline-offset-2"
        >
          Details
        </button>
      }
    >
      <MobileCardField label="Actor">{row.actorEmail}</MobileCardField>
      <MobileCardField label="When" numeric>
        {formatIstDateTime(new Date(row.createdAt))}
      </MobileCardField>
    </MobileCard>
  ));

  return (
    <>
      <ResponsiveTable table={table} cards={cards} />
      <AuditDetailDialog row={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function EntityCell({ row }: { row: AuditRow }) {
  const href = entityHref(row.entityType, row.entityId);
  const label = row.entityLabel ?? row.entityId ?? row.entityType;

  if (!href) {
    return (
      <span>
        <span className="text-muted-foreground">{row.entityType}</span>
        {row.entityLabel || row.entityId ? <span className="ml-1">{label}</span> : null}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-muted-foreground">{row.entityType}</span>
      <Link
        href={href as Route}
        onClick={(event) => event.stopPropagation()}
        className="inline-flex items-center gap-1 hover:underline"
      >
        {label}
        <ExternalLink className="size-3" />
      </Link>
    </span>
  );
}
