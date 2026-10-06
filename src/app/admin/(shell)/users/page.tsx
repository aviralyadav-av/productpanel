import type { Metadata } from "next";
import Link from "next/link";
import { SearchX, Users } from "lucide-react";

import { requirePermission } from "@/lib/auth/guards";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { Button } from "@/components/ui/button";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs, PaginationBar, SearchInput } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGate } from "@/components/shared/permission-gate";
import { ParamSelect } from "@/features/pages/components/param-select";

import { InviteUserDialog } from "@/features/users/components/invite-dialog";
import { UserTable } from "@/features/users/components/user-table";
import { listRoleOptions, listUsers, userStatusCounts } from "@/features/users/queries";
import { hasUserFilters, parseUserFilters, resolveUserSort } from "@/features/users/schemas";

export const metadata: Metadata = { title: "Admin users" };

/**
 * /admin/users (blueprint §1 Users, §14.D3).
 *
 * Soft-deleted accounts are hidden by default and reachable through the
 * "Deactivated" tab: the rows exist only so audit entries keep a foreign key,
 * and `<id>@deleted.local` in the everyday list would be noise.
 */
export default async function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  const actor = await requirePermission("users.view");

  const params = (await searchParams) as SearchParams;
  const list = parseListParams(params, { defaultSort: "name", defaultOrder: "asc", pageSize: 25 });
  const sort = resolveUserSort(list.sort);
  const filters = parseUserFilters(params);

  const [result, counts, roles] = await Promise.all([
    listUsers({ ...list, sort }, filters),
    userStatusCounts(filters),
    listRoleOptions(actor),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Admin users"
        description="Everyone who can sign in to this admin. An invite creates the account with an unusable password - people always choose their own, through a link."
        actions={
          <PermissionGate require="users.create">
            <InviteUserDialog roles={roles} />
          </PermissionGate>
        }
      />

      <div className="surface overflow-hidden">
        <DataTableToolbar
          search={<SearchInput placeholder="Search name, email or phone…" />}
          filters={
            <>
              <FilterTabs
                paramKey="status"
                allLabel={`All ${counts.all}`}
                options={[
                  { value: "active", label: "Active", count: counts.active },
                  { value: "inactive", label: "Inactive", count: counts.inactive },
                  { value: "deleted", label: "Deactivated", count: counts.deleted },
                ]}
              />
              <ParamSelect
                paramKey="role"
                allLabel="All roles"
                ariaLabel="Filter by role"
                options={roles.map((role) => ({ value: role.id, label: role.name }))}
              />
              <ParamSelect
                paramKey="twofa"
                allLabel="2FA: any"
                ariaLabel="Filter by two-factor status"
                className="w-32"
                options={[
                  { value: "1", label: "2FA on" },
                  { value: "0", label: "2FA off" },
                ]}
              />
            </>
          }
        />

        {result.rows.length === 0 ? (
          hasUserFilters(filters) ? (
            <EmptyState
              icon={SearchX}
              title="No users match these filters"
              description="Try a different search, or clear the filters."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/users">Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Users}
              title="No admin users yet"
              description="Invite the first colleague who needs access."
              action={
                <PermissionGate require="users.create">
                  <InviteUserDialog roles={roles} />
                </PermissionGate>
              }
            />
          )
        ) : (
          <>
            <UserTable rows={result.rows} sort={sort} order={list.order} />
            <PaginationBar meta={result.meta} itemLabel="users" />
          </>
        )}
      </div>
    </div>
  );
}
