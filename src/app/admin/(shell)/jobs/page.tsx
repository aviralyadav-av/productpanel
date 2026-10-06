import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { ListChecks, SearchX } from "lucide-react";

import { requirePermission } from "@/lib/auth/guards";
import { JOB_STATUSES, JOB_STATUS_META } from "@/lib/enums";
import { formatIstDateTime } from "@/lib/dates";
import { formatNumber } from "@/lib/money";
import { one, parseListParams, type SearchParams } from "@/lib/list-params";
import { Button } from "@/components/ui/button";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs, PaginationBar, SearchInput } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGate } from "@/components/shared/permission-gate";
import { StatCard } from "@/components/shared/stat-card";

import { JobDetailSheet, JobsFilterBar, JobsTable } from "@/features/jobs/components/jobs-table";
import { RunPendingButton } from "@/features/jobs/components/run-pending-button";
import { RecurringJobsTable, WorkerBanner } from "@/features/jobs/components/scheduler-info";
import { getJobDetail, jobStatusCounts, jobsPageData, listJobRows } from "@/features/jobs/queries";
import { hasJobFilters, parseJobFilters } from "@/features/jobs/schemas";

export const metadata: Metadata = { title: "Background jobs" };

/**
 * /admin/jobs (blueprint §2 System, D14 `jobs.view` / `jobs.manage`).
 *
 * The queue is the part of the platform an operator never thinks about until
 * something did not happen - an email that never arrived, a payout that never
 * generated. So this screen is built around that moment: what is stuck, why it
 * failed, and the one button that makes it run again.
 */
export default async function JobsPage({ searchParams }: PageProps<"/admin/jobs">) {
  await requirePermission("jobs.view");

  const params = (await searchParams) as SearchParams;
  const list = parseListParams(params, { defaultSort: "createdAt", defaultOrder: "desc", pageSize: 25 });
  const filters = parseJobFilters(params);
  const openId = one(params, "job");

  const [page, counts, result, detail] = await Promise.all([
    jobsPageData(),
    jobStatusCounts(filters),
    listJobRows(list, filters),
    openId ? getJobDetail(openId) : Promise.resolve(null),
  ]);

  const typeOptions = [...new Set([...page.presentTypes, ...page.knownTypes])].sort();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Background jobs"
        description="Emails, payouts, stock sweeps and cache rebuilds all run through one Postgres-backed queue. Every handler is idempotent, so a job that runs twice is safe — which is what makes requeueing a stuck job the right first move."
        actions={
          <PermissionGate require="jobs.manage">
            <RunPendingButton />
          </PermissionGate>
        }
      />

      <section aria-label="Queue health" className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatCard
          label="Pending"
          value={formatNumber(page.stats.byStatus.PENDING)}
          href={"/admin/jobs?status=PENDING" as Route}
          higherIsBetter={false}
          hint={
            page.stats.oldestPendingRunAt
              ? `Oldest due ${formatIstDateTime(new Date(page.stats.oldestPendingRunAt))}`
              : "Nothing waiting"
          }
        />
        <StatCard
          label="Running"
          value={formatNumber(page.stats.byStatus.RUNNING)}
          href={"/admin/jobs?status=RUNNING" as Route}
          hint="Claimed by a worker right now"
        />
        <StatCard
          label="Failed"
          value={formatNumber(page.stats.byStatus.FAILED)}
          href={"/admin/jobs?status=FAILED" as Route}
          higherIsBetter={false}
          hint={`${formatNumber(page.stats.failed24h)} in the last 24 h`}
        />
        <StatCard
          label="Completed 24 h"
          value={formatNumber(page.stats.completed24h)}
          hint="Proof the queue is being drained"
        />
        <StatCard
          label="Handlers"
          value={`${page.registeredTypes.length}/${page.knownTypes.length}`}
          hint="Registered in this process vs types known"
          higherIsBetter
        />
      </section>

      <WorkerBanner
        registeredCount={page.registeredTypes.length}
        knownCount={page.knownTypes.length}
        oldestPendingRunAt={page.stats.oldestPendingRunAt}
        lagging={page.stats.workerLagging}
      />

      <div className="surface overflow-hidden">
        <DataTableToolbar
          search={<SearchInput placeholder="Search id, type, dedupe key or error…" />}
          filters={
            <>
              <FilterTabs
                paramKey="status"
                allLabel={`All ${counts.all}`}
                options={JOB_STATUSES.map((status) => ({
                  value: status,
                  label: JOB_STATUS_META[status].label,
                  count: counts[status],
                }))}
              />
              <JobsFilterBar types={typeOptions} />
            </>
          }
        />

        {result.rows.length === 0 ? (
          hasJobFilters(filters) ? (
            <EmptyState
              icon={SearchX}
              title="No jobs match these filters"
              description="Try a different search, widen the date range, or clear the filters."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href={"/admin/jobs" as Route}>Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={ListChecks}
              title="The queue is empty"
              description="Jobs appear when the platform queues one — an email, a payout, a price refresh — or when the recurring schedule below fires."
            />
          )
        ) : (
          <>
            <JobsTable rows={result.rows} sort={list.sort} order={list.order} />
            <PaginationBar meta={result.meta} itemLabel="jobs" />
          </>
        )}
      </div>

      <RecurringJobsTable rows={page.recurring} />

      <JobDetailSheet job={detail} />
    </div>
  );
}
