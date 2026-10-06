"use client";

import Link from "next/link";
import type { Route } from "next";
import { Lock } from "lucide-react";

import { formatIstDate } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { SortableTh } from "@/components/shared/sortable-th";

import type { RoleListRow } from "@/features/roles/schemas";

/**
 * The role list. System roles are marked with a lock and sort first: they are
 * the nine seeded roles the guards were designed around, and they are
 * view-only (§11.16) - a custom role is the way to change anything.
 */
export function RoleTable({
  rows,
  sort,
  order,
}: {
  rows: RoleListRow[];
  sort: string;
  order: "asc" | "desc";
}) {
  const table = (
    <DataTable>
      <DataTableHead>
        <SortableTh column="name" label="Role" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <SortableTh column="slug" label="Slug" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <Th>Type</Th>
        <SortableTh column="users" label="Users" currentSort={sort} currentOrder={order} align="right" />
        <SortableTh column="permissions" label="Permissions" currentSort={sort} currentOrder={order} align="right" />
        <SortableTh column="updatedAt" label="Updated" currentSort={sort} currentOrder={order} />
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.id}>
            <Td>
              <Link
                href={`/admin/roles/${row.id}` as Route}
                className="text-xs font-medium hover:underline"
              >
                {row.name}
              </Link>
              {row.description ? (
                <p className="text-muted-foreground max-w-md truncate text-[11px]">
                  {row.description}
                </p>
              ) : null}
            </Td>
            <Td className="text-muted-foreground text-xs">
              <code>{row.slug}</code>
            </Td>
            <Td>
              {row.isSystem ? (
                <Badge variant="outline" className="h-5 gap-1 font-normal">
                  <Lock className="size-3" />
                  System
                </Badge>
              ) : (
                <Badge variant="secondary" className="h-5 font-normal">
                  Custom
                </Badge>
              )}
            </Td>
            <Td numeric className="text-xs">
              {row.userCount}
            </Td>
            <Td numeric className="text-xs">
              {row.slug === "super-admin" ? "all" : row.permissionCount}
            </Td>
            <Td numeric className="text-xs">
              {formatIstDate(new Date(row.updatedAt))}
            </Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = rows.map((row) => (
    <MobileCard
      key={row.id}
      href={`/admin/roles/${row.id}`}
      title={row.name}
      subtitle={row.slug}
      meta={
        row.isSystem ? (
          <Badge variant="outline" className="h-5 font-normal">
            System
          </Badge>
        ) : null
      }
    >
      <MobileCardField label="Users" numeric>
        {String(row.userCount)}
      </MobileCardField>
      <MobileCardField label="Permissions" numeric>
        {row.slug === "super-admin" ? "all" : String(row.permissionCount)}
      </MobileCardField>
    </MobileCard>
  ));

  return <ResponsiveTable table={table} cards={cards} />;
}
