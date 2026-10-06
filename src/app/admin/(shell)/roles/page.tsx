import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { Plus, SearchX, ShieldCheck } from "lucide-react";

import { requirePermission } from "@/lib/auth/guards";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { Button } from "@/components/ui/button";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs, PaginationBar, SearchInput } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGate } from "@/components/shared/permission-gate";

import { RoleTable } from "@/features/roles/components/role-table";
import { listRoles } from "@/features/roles/queries";
import { hasRoleFilters, parseRoleFilters, resolveRoleSort } from "@/features/roles/schemas";

export const metadata: Metadata = { title: "Roles" };

/**
 * /admin/roles (blueprint §3, §11.16).
 *
 * The nine system roles are the ones the permission matrix in the blueprint
 * describes; they are view-only. Anything a store needs beyond them is a
 * custom role, which is why "New role" is the primary action here.
 */
export default async function RolesPage({ searchParams }: PageProps<"/admin/roles">) {
  await requirePermission("roles.view");

  const params = (await searchParams) as SearchParams;
  const list = parseListParams(params, { defaultSort: "name", defaultOrder: "asc", pageSize: 50 });
  const sort = resolveRoleSort(list.sort);
  const filters = parseRoleFilters(params);

  const result = await listRoles({ ...list, sort }, filters);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Roles"
        description="What each group of colleagues can see and do. A role can never grant more than the person editing it already holds."
        actions={
          <PermissionGate require="roles.manage">
            <Button asChild size="sm">
              <Link href={"/admin/roles/new" as Route}>
                <Plus className="size-3.5" />
                New role
              </Link>
            </Button>
          </PermissionGate>
        }
      />

      <div className="surface overflow-hidden">
        <DataTableToolbar
          search={<SearchInput placeholder="Search roles…" />}
          filters={
            <FilterTabs
              paramKey="system"
              allLabel="All"
              options={[
                { value: "1", label: "System" },
                { value: "0", label: "Custom" },
              ]}
            />
          }
        />

        {result.rows.length === 0 ? (
          hasRoleFilters(filters) ? (
            <EmptyState
              icon={SearchX}
              title="No roles match"
              description="Try a different search or clear the filter."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/roles">Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={ShieldCheck}
              title="No roles"
              description="Re-run the seed to restore the nine system roles."
            />
          )
        ) : (
          <>
            <RoleTable rows={result.rows} sort={sort} order={list.order} />
            <PaginationBar meta={result.meta} itemLabel="roles" />
          </>
        )}
      </div>
    </div>
  );
}
