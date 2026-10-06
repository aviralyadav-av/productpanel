"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Ban, RotateCcw, TriangleAlert } from "lucide-react";

import { formatIstDateTime } from "@/lib/dates";
import { JOB_STATUS_META } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { KeyValueList } from "@/components/shared/key-value-list";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { usePermission } from "@/components/shared/permission-gate";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { SortableTh } from "@/components/shared/sortable-th";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";
import { useQueryNav } from "@/hooks/use-query-nav";

import { cancelJobAction, requeueJobAction } from "@/features/jobs/actions";
import type { JobDetailView, JobRowView } from "@/features/jobs/schemas";

/**
 * The queue as a table. Every row links to `?job=<id>`, which opens the sheet
 * with the payload - that is where an operator actually diagnoses a failure,
 * because "orders.after_payment failed" means nothing without knowing which
 * payment.
 */

export function JobStatusBadge({ status }: { status: JobRowView["status"] }) {
  const meta = JOB_STATUS_META[status];
  return <StatusPill label={meta?.label ?? status} tone={meta?.tone ?? "neutral"} />;
}

export function JobsTable({
  rows,
  sort,
  order,
}: {
  rows: JobRowView[];
  sort: string;
  order: "asc" | "desc";
}) {
  const { hrefFor } = useQueryNav();

  const table = (
    <DataTable>
      <DataTableHead>
        <SortableTh column="createdAt" label="Created" currentSort={sort} currentOrder={order} />
        <SortableTh column="type" label="Type" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <SortableTh column="status" label="Status" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <SortableTh column="runAt" label="Runs at" currentSort={sort} currentOrder={order} />
        <SortableTh column="attempts" label="Tries" currentSort={sort} currentOrder={order} align="right" />
        <Th>Last error</Th>
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.id}>
            <Td>
              <Link href={hrefFor({ job: row.id }) as Route} className="text-xs hover:underline" scroll={false}>
                {formatIstDateTime(new Date(row.createdAt))}
              </Link>
            </Td>
            <Td>
              <Link href={hrefFor({ job: row.id }) as Route} className="text-sm font-medium hover:underline" scroll={false}>
                {row.type}
              </Link>
              {row.hasHandler ? null : (
                <span
                  className="text-warning ml-2 inline-flex items-center gap-1 text-[11px]"
                  title="No handler is registered for this type in the web process. The worker may still handle it."
                >
                  <TriangleAlert className="size-3" /> no handler here
                </span>
              )}
              {row.dedupeKey ? (
                <span className="text-muted-foreground block truncate text-[11px]">{row.dedupeKey}</span>
              ) : null}
            </Td>
            <Td>
              <JobStatusBadge status={row.status} />
            </Td>
            <Td>
              <span className="text-muted-foreground text-xs">{formatIstDateTime(new Date(row.runAt))}</span>
            </Td>
            <Td align="right" numeric>
              {row.attempts}/{row.maxAttempts}
            </Td>
            <Td>
              <span className="text-destructive line-clamp-1 text-[11px]">{row.lastError ?? ""}</span>
            </Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = rows.map((row) => (
    <MobileCard
      key={row.id}
      title={row.type}
      subtitle={formatIstDateTime(new Date(row.createdAt))}
      href={hrefFor({ job: row.id })}
      meta={<JobStatusBadge status={row.status} />}
    >
      <MobileCardField label="Tries" numeric>
        {row.attempts}/{row.maxAttempts}
      </MobileCardField>
      <MobileCardField label="Runs at">{formatIstDateTime(new Date(row.runAt))}</MobileCardField>
      {row.lastError ? <MobileCardField label="Error">{row.lastError}</MobileCardField> : null}
    </MobileCard>
  ));

  return <ResponsiveTable table={table} cards={cards} />;
}

/** Type filter plus the day range; status lives in FilterTabs on the page. */
export function JobsFilterBar({ types }: { types: string[] }) {
  const { navigate, searchParams } = useQueryNav();
  const type = searchParams.get("type") ?? "";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Filter by job type"
        className="border-input bg-background focus-visible:ring-ring/50 h-8 rounded-md border px-2 text-xs shadow-xs outline-none focus-visible:ring-[3px]"
        value={type}
        onChange={(event) => navigate({ type: event.target.value || null })}
      >
        <option value="">All types</option>
        {types.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <DateRangePicker fallback="30d" />
    </div>
  );
}

/** `?job=<id>` opens one job over the list; closing drops the param. */
export function JobDetailSheet({ job }: { job: JobDetailView | null }) {
  const router = useRouter();
  const { navigate } = useQueryNav();
  const { pending, run } = useActionToast();
  const canManage = usePermission("jobs.manage");

  function close() {
    navigate({ job: null });
  }

  if (!job) return null;

  return (
    <Sheet open onOpenChange={(open) => (!open ? close() : undefined)}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <div className="flex items-start justify-between gap-3 pr-6">
            <div className="min-w-0">
              <SheetTitle className="text-sm">{job.type}</SheetTitle>
              <p className="text-muted-foreground mt-0.5 font-mono text-[11px]">{job.id}</p>
            </div>
            <JobStatusBadge status={job.status} />
          </div>
        </SheetHeader>

        <div className="space-y-4 p-4">
          <KeyValueList
            columns={2}
            items={[
              { label: "Attempts", value: `${job.attempts} of ${job.maxAttempts}`, numeric: true },
              { label: "Priority", value: job.priority, numeric: true },
              { label: "Created", value: formatIstDateTime(new Date(job.createdAt)) },
              { label: "Runs at", value: formatIstDateTime(new Date(job.runAt)) },
              { label: "Completed", value: job.completedAt ? formatIstDateTime(new Date(job.completedAt)) : "—" },
              { label: "Locked by", value: job.lockedBy ?? "—" },
              { label: "Dedupe key", value: job.dedupeKey ?? "—", wide: true },
            ]}
          />

          {job.hasHandler ? null : (
            <p className="border-warning/40 bg-warning-muted/40 text-warning rounded-md border p-2.5 text-[11px]">
              No handler for <code>{job.type}</code> is registered in the web process. If the worker does not register
              one either, this job will fail {job.maxAttempts} times and stop.
            </p>
          )}

          {job.lastError ? (
            <div className="border-destructive/40 bg-destructive/5 rounded-md border p-3">
              <p className="text-destructive text-xs font-medium">Last error</p>
              <p className="text-muted-foreground mt-1 font-mono text-[11px] break-words">{job.lastError}</p>
            </div>
          ) : null}

          <JsonBlock title="Payload" value={job.payload} />
          <JsonBlock title="Result" value={job.result} emptyLabel="No result yet." />

          {canManage ? (
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending || job.status === "RUNNING"}
                onClick={() => void run(() => requeueJobAction(job.id), { onSuccess: () => router.refresh() })}
              >
                <RotateCcw /> Requeue
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending || job.status !== "PENDING"}
                onClick={() => void run(() => cancelJobAction(job.id), { onSuccess: () => router.refresh() })}
              >
                <Ban /> Cancel
              </Button>
              <p className="text-muted-foreground text-[11px]">
                Requeue resets the attempt count; cancel only applies to a job that has not started.
              </p>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function JsonBlock({
  title,
  value,
  emptyLabel = "Empty.",
}: {
  title: string;
  value: unknown;
  emptyLabel?: string;
}) {
  const text = React.useMemo(() => {
    if (value === null || value === undefined) return null;
    try {
      const json = JSON.stringify(value, null, 2);
      return json === "{}" ? null : json;
    } catch {
      return String(value);
    }
  }, [value]);

  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold">{title}</h3>
      {text ? (
        <pre className="bg-muted/40 max-h-72 overflow-auto rounded-md border p-3 font-mono text-[11px] whitespace-pre-wrap">
          {text}
        </pre>
      ) : (
        <p className="text-muted-foreground text-xs">{emptyLabel}</p>
      )}
    </div>
  );
}
