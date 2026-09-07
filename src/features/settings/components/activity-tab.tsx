import { History } from "lucide-react";

import { Panel } from "@/components/shared/panel";
import { EmptyState } from "@/components/shared/empty-state";
import {
  DataTable,
  DataTableBody,
  DataTableHead,
  Td,
  Th,
  Tr,
} from "@/components/shared/data-table";
import {
  FilterTabs,
  PaginationBar,
  SearchInput,
} from "@/components/shared/list-controls";
import { formatIstDateTime } from "@/lib/dates";
import { asObject } from "@/lib/json";
import type { PageMeta } from "@/lib/list-params";
import type { AuditRow } from "../queries";

type Facet = { value: string; label: string; count: number };

/**
 * The audit log, rendered from the AuditLog table exactly as writeAudit left
 * it. The diff column is a plain <details> element: expanding a row needs no
 * client JavaScript, which keeps a 50-row page cheap.
 */
export function ActivityTab({
  rows,
  meta,
  filters,
  isFiltered,
  facets,
}: {
  rows: AuditRow[];
  meta: PageMeta;
  filters: { action?: string; entity?: string; q: string };
  isFiltered: boolean;
  facets: { actions: Facet[]; entities: Facet[] };
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          placeholder="Search summaries…"
          className="w-full sm:w-72"
        />

        {facets.entities.length > 0 ? (
          <div className="max-w-full overflow-x-auto">
            <FilterTabs
              paramKey="entity"
              allLabel="All entities"
              options={facets.entities}
            />
          </div>
        ) : null}

        {facets.actions.length > 0 ? (
          <div className="max-w-full overflow-x-auto">
            <FilterTabs
              paramKey="action"
              allLabel="All actions"
              options={facets.actions}
            />
          </div>
        ) : null}
      </div>

      <Panel
        title="Activity log"
        description={`Newest first · ${meta.pageSize} per page`}
        bodyClassName="p-0"
      >
        <p className="text-muted-foreground border-b px-4 py-2 text-[11px] leading-relaxed">
          Append-only. Every admin mutation writes one row here and there is no
          edit or delete path for this table anywhere in the panel.
        </p>

        {rows.length === 0 ? (
          <EmptyState
            icon={History}
            title={isFiltered ? "No entries match" : "Nothing logged yet"}
            description={
              isFiltered
                ? `Nothing recorded${filters.q ? ` mentioning “${filters.q}”` : ""}${
                    filters.entity ? ` for ${filters.entity}` : ""
                  }${filters.action ? ` from ${filters.action}` : ""}. Clear the filters above to see the whole log.`
                : "Entries appear the moment anyone saves a change in this panel — a product edit, an order status change, a settings save."
            }
          />
        ) : (
          <DataTable>
            <DataTableHead>
              <Th width="10.5rem">Time (IST)</Th>
              <Th>Actor</Th>
              <Th>Action</Th>
              <Th>Entity</Th>
              <Th>Change</Th>
              <Th>IP</Th>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td numeric className="text-muted-foreground align-top">
                    {formatIstDateTime(row.createdAt)}
                  </Td>
                  <Td className="align-top">{row.actorEmail}</Td>
                  <Td className="align-top">
                    <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-[11px]">
                      {row.action}
                    </code>
                  </Td>
                  <Td className="align-top">
                    <span>{row.entityType}</span>
                    {row.entityId ? (
                      <span
                        title={row.entityId}
                        className="text-muted-foreground block max-w-40 truncate font-mono text-[10px]"
                      >
                        {row.entityId}
                      </span>
                    ) : null}
                  </Td>
                  <Td className="max-w-lg align-top">
                    <p className="leading-snug">{row.summary}</p>
                    <DiffDetails diff={row.diff} />
                  </Td>
                  <Td className="text-muted-foreground align-top font-mono text-[10px]">
                    {row.ip ?? "—"}
                  </Td>
                </Tr>
              ))}
            </DataTableBody>
          </DataTable>
        )}

        <PaginationBar meta={meta} itemLabel="entries" />
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff
//
// writeAudit stores one of two shapes in the jsonb column: { field: { from, to } }
// when it had a before and an after, or a flat redacted object when it only had
// one side (a create or a delete). Both are rendered here rather than dumping
// raw JSON at the operator.
// ---------------------------------------------------------------------------

type DiffEntry =
  | { field: string; kind: "change"; from: string; to: string }
  | { field: string; kind: "value"; value: string };

function DiffDetails({ diff }: { diff: unknown }) {
  const entries = readDiff(diff);
  if (entries.length === 0) return null;

  return (
    <details className="mt-1">
      <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer text-[11px]">
        {entries.length} field{entries.length === 1 ? "" : "s"}
      </summary>

      <dl className="mt-1.5 space-y-1 border-l pl-2.5">
        {entries.map((entry) => (
          <div key={entry.field} className="grid gap-0.5">
            <dt className="text-muted-foreground font-mono text-[10px]">
              {entry.field}
            </dt>
            <dd className="text-[11px] leading-snug wrap-break-word">
              {entry.kind === "change" ? (
                <>
                  <span className="text-muted-foreground line-through">
                    {entry.from}
                  </span>
                  <span className="text-muted-foreground mx-1.5">→</span>
                  <span className="font-medium">{entry.to}</span>
                </>
              ) : (
                entry.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function readDiff(diff: unknown): DiffEntry[] {
  const source = asObject<Record<string, unknown>>(diff, {});

  return Object.entries(source).map(([field, value]): DiffEntry => {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      ("from" in value || "to" in value)
    ) {
      const pair = value as { from?: unknown; to?: unknown };
      return {
        field,
        kind: "change",
        from: formatDiffValue(pair.from),
        to: formatDiffValue(pair.to),
      };
    }

    return { field, kind: "value", value: formatDiffValue(value) };
  });
}

function formatDiffValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.length === 0 ? '""' : value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}
