import { Terminal } from "lucide-react";

import { formatIstDateTime } from "@/lib/dates";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { StatusPill } from "@/components/shared/status-badge";

import { CADENCE_LABELS, type RecurringJobView } from "@/features/jobs/schemas";

/**
 * The recurring schedule and how the queue is actually driven.
 *
 * Server components - nothing here is interactive. The banner is the part
 * operators need most: the admin can trigger a run, but nothing happens on a
 * timer unless the worker process or the cron endpoint is calling in. A jobs
 * page that hid that would make a stopped worker look like an empty queue.
 */
export function WorkerBanner({
  registeredCount,
  knownCount,
  oldestPendingRunAt,
  lagging,
}: {
  registeredCount: number;
  knownCount: number;
  oldestPendingRunAt: string | null;
  /** Computed server-side (queries.ts): a component must not read the clock. */
  lagging: boolean;
}) {
  return (
    <section
      className={
        lagging
          ? "border-warning/40 bg-warning-muted/40 rounded-lg border p-4"
          : "surface p-4"
      }
    >
      <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-tight">
        <Terminal className="size-3.5" /> How jobs run
      </h2>
      <div className="text-muted-foreground mt-1.5 space-y-1.5 text-xs leading-relaxed">
        <p>
          Jobs are rows in Postgres, claimed with <code className="bg-muted rounded px-1">FOR UPDATE SKIP LOCKED</code>,
          so more than one runner is safe and every handler must be idempotent. Two things drive them:
          <code className="bg-muted mx-1 rounded px-1">npm run worker</code> (a long-running process that polls and also
          tops up the recurring schedule) and{" "}
          <code className="bg-muted mx-1 rounded px-1">POST /api/internal/jobs/run</code> with the{" "}
          <code className="bg-muted rounded px-1">X-Cron-Secret</code> header, for a platform cron. “Run pending now”
          above does one batch inline for when neither is up.
        </p>
        <p>
          {registeredCount} of {knownCount} job types have a handler registered in this web process. The worker
          registers the same set through <code className="bg-muted rounded px-1">registerAllJobHandlers()</code>; a type
          with no handler anywhere will retry and then fail.
        </p>
        {lagging ? (
          <p className="text-warning font-medium">
            The oldest due job has been waiting since {oldestPendingRunAt ? formatIstDateTime(new Date(oldestPendingRunAt)) : "a while"}. That usually
            means no worker is polling.
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function RecurringJobsTable({ rows }: { rows: RecurringJobView[] }) {
  const table = (
    <DataTable>
      <DataTableHead>
        <Th>Type</Th>
        <Th>Cadence</Th>
        <Th>Owner</Th>
        <Th>Last run</Th>
        <Th>Next bucket</Th>
        <Th align="center">Handler</Th>
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.type}>
            <Td>
              <code className="bg-muted rounded px-1 py-0.5 text-[11px]">{row.type}</code>
            </Td>
            <Td>
              <span className="text-xs">{CADENCE_LABELS[row.every] ?? row.every}</span>
            </Td>
            <Td>
              <span className="text-muted-foreground text-xs">{row.owner}</span>
            </Td>
            <Td>
              <span className="text-muted-foreground text-xs">
                {row.lastRunAt ? formatIstDateTime(new Date(row.lastRunAt)) : "Never"}
                {row.lastStatus ? ` · ${row.lastStatus}` : ""}
              </span>
            </Td>
            <Td>
              <span className="text-muted-foreground text-xs">
                {row.nextExpectedAt ? formatIstDateTime(new Date(row.nextExpectedAt)) : "Dormant"}
              </span>
            </Td>
            <Td align="center">
              <StatusPill
                label={row.hasHandler ? "Registered" : "Missing"}
                tone={row.hasHandler ? "success" : "warning"}
              />
            </Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = rows.map((row) => (
    <MobileCard
      key={row.type}
      title={row.type}
      subtitle={CADENCE_LABELS[row.every] ?? row.every}
      meta={
        <StatusPill label={row.hasHandler ? "Registered" : "Missing"} tone={row.hasHandler ? "success" : "warning"} />
      }
    >
      <MobileCardField label="Owner">{row.owner}</MobileCardField>
      <MobileCardField label="Last run">
        {row.lastRunAt ? formatIstDateTime(new Date(row.lastRunAt)) : "Never"}
      </MobileCardField>
    </MobileCard>
  ));

  return (
    <section className="surface overflow-hidden">
      <header className="border-b px-4 py-2">
        <h2 className="text-xs font-semibold tracking-tight">Recurring schedule</h2>
        <p className="text-muted-foreground text-[11px]">
          One job per cadence bucket, deduplicated by key — calling the scheduler more often costs a lookup and creates
          nothing. A cadence whose handler is missing is skipped entirely rather than queued to fail.
        </p>
      </header>
      <ResponsiveTable table={table} cards={cards} />
    </section>
  );
}
