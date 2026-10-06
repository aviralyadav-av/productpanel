import type { Metadata } from "next";
import Link from "next/link";
import { History, SearchX } from "lucide-react";

import { requirePermission } from "@/lib/auth/guards";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { Button } from "@/components/ui/button";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { EmptyState } from "@/components/shared/empty-state";
import { PaginationBar, SearchInput } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";

import { AuditTable } from "@/features/audit/components/audit-table";
import { AuditExportButton, AuditFilters } from "@/features/audit/components/audit-toolbar";
import { getAuditFacets, listAuditLog } from "@/features/audit/queries";
import { hasAuditFilters, parseAuditFilters, resolveAuditSort } from "@/features/audit/schemas";

export const metadata: Metadata = { title: "Audit log" };

/**
 * /admin/audit-log (blueprint §1 Audit log, §14.D13).
 *
 * Append-only and server-paginated: the table has no edit path by design (a
 * database trigger rejects UPDATE and DELETE), and it is the one screen where
 * an unbounded query would eventually be a real problem, so every read carries
 * a `take`.
 */
export default async function AuditLogPage({ searchParams }: PageProps<"/admin/audit-log">) {
  await requirePermission("audit.view");

  const params = (await searchParams) as SearchParams;
  const list = parseListParams(params, {
    defaultSort: "createdAt",
    defaultOrder: "desc",
    pageSize: 50,
  });
  const sort = resolveAuditSort(list.sort);
  const filters = parseAuditFilters(params);

  const [result, facets] = await Promise.all([
    listAuditLog({ ...list, sort }, filters),
    getAuditFacets(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit log"
        description="Every security-relevant and money-relevant change, who made it and from where. Opens on the last 30 days; entries can never be edited or deleted - the database refuses."
      />

      <div className="surface overflow-hidden">
        <DataTableToolbar
          search={<SearchInput placeholder="Search summary, entity or id…" />}
          filters={<AuditFilters facets={facets} />}
          actions={<AuditExportButton />}
        />

        {result.rows.length === 0 ? (
          hasAuditFilters(filters) ? (
            <EmptyState
              icon={SearchX}
              title="No entries match these filters"
              description="Try a wider date range, another actor, or clear the filters."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/audit-log">Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={History}
              title="Nothing in this range"
              description="Sign-ins, permission changes, settings edits, refunds and exports all land here. The screen opens on the last 30 days - widen the date range to look further back."
            />
          )
        ) : (
          <>
            <AuditTable rows={result.rows} sort={sort} order={list.order} />
            <PaginationBar meta={result.meta} itemLabel="entries" />
          </>
        )}
      </div>
    </div>
  );
}
