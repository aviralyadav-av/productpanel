"use client";

import Link from "next/link";
import type { Route } from "next";
import { ShieldCheck, ShieldOff } from "lucide-react";

import { formatIstDate, formatIstDateTime } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { SortableTh } from "@/components/shared/sortable-th";
import { StatusPill } from "@/components/shared/status-badge";

import type { UserListRow } from "@/features/users/schemas";

/**
 * The admin user list. Every row is a link to the profile - all the actions
 * (role, status, sessions, reset) need the context and the D3 answers that
 * only the detail page has, so the list deliberately has no row menu.
 */
export function UserStatusBadge({ row }: { row: UserListRow }) {
  if (row.deletedAt) return <StatusPill label="Deactivated" tone="danger" />;
  return row.isActive ? (
    <StatusPill label="Active" tone="success" />
  ) : (
    <StatusPill label="Inactive" tone="warning" />
  );
}

export function TwoFactorPill({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <span className="text-success inline-flex items-center gap-1 text-xs">
      <ShieldCheck className="size-3.5" />
      On
    </span>
  ) : (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
      <ShieldOff className="size-3.5" />
      Off
    </span>
  );
}

export function UserTable({
  rows,
  sort,
  order,
}: {
  rows: UserListRow[];
  sort: string;
  order: "asc" | "desc";
}) {
  const table = (
    <DataTable>
      <DataTableHead>
        <SortableTh column="name" label="Name" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <SortableTh column="email" label="Email" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <SortableTh column="role" label="Role" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <Th>Status</Th>
        <Th>2FA</Th>
        <SortableTh column="lastLoginAt" label="Last sign-in" currentSort={sort} currentOrder={order} />
        <Th align="right">Sessions</Th>
        <SortableTh column="createdAt" label="Added" currentSort={sort} currentOrder={order} />
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.id}>
            <Td>
              <Link
                href={`/admin/users/${row.id}` as Route}
                className="text-xs font-medium hover:underline"
              >
                {row.name ?? "Unnamed"}
              </Link>
              {row.forcePasswordChange ? (
                <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[10px] font-normal">
                  must reset
                </Badge>
              ) : null}
            </Td>
            <Td className="text-muted-foreground max-w-[16rem] truncate text-xs">{row.email}</Td>
            <Td className="text-xs">
              {row.roleName ? (
                <Badge variant="secondary" className="h-5 font-normal">
                  {row.roleName}
                </Badge>
              ) : (
                <span className="text-muted-foreground/70">No role</span>
              )}
            </Td>
            <Td>
              <UserStatusBadge row={row} />
            </Td>
            <Td>
              <TwoFactorPill enabled={row.twoFactorEnabled} />
            </Td>
            <Td numeric className="text-xs">
              {row.lastLoginAt ? (
                formatIstDateTime(new Date(row.lastLoginAt))
              ) : (
                <span className="text-muted-foreground/70">Never</span>
              )}
            </Td>
            <Td numeric className="text-xs">
              {row.sessionCount}
            </Td>
            <Td numeric className="text-xs">
              {formatIstDate(new Date(row.createdAt))}
            </Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = rows.map((row) => (
    <MobileCard
      key={row.id}
      href={`/admin/users/${row.id}`}
      title={row.name ?? "Unnamed"}
      subtitle={row.email}
      meta={<UserStatusBadge row={row} />}
    >
      <MobileCardField label="Role">{row.roleName ?? "No role"}</MobileCardField>
      <MobileCardField label="2FA">{row.twoFactorEnabled ? "On" : "Off"}</MobileCardField>
      <MobileCardField label="Last sign-in" numeric>
        {row.lastLoginAt ? formatIstDate(new Date(row.lastLoginAt)) : "Never"}
      </MobileCardField>
      <MobileCardField label="Sessions" numeric>
        {String(row.sessionCount)}
      </MobileCardField>
    </MobileCard>
  ));

  return <ResponsiveTable table={table} cards={cards} />;
}
