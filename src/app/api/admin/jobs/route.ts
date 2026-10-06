import { parseListQuery, withAdminApi } from "@/lib/api/admin";
import { JOB_SORTS, jobsOverview, listJobs } from "@/features/jobs/queries";

/**
 * GET /api/admin/jobs?status=&type=&q=&page=&pageSize=&sort=&order=
 *
 * The standard list envelope `{ data, meta }` plus `stats` (queue counts by
 * status, open/failed per type, oldest due job) and `types` (known vs
 * registered vs present) - the jobs page needs all three on every render and
 * one round trip is cheaper than three.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, {
      defaultSort: "createdAt",
      defaultOrder: "desc",
      allowedSorts: JOB_SORTS,
    });
    const [{ rows, meta }, overview] = await Promise.all([
      listJobs(query, { status: query.filter("status"), type: query.filter("type"), q: query.q }),
      jobsOverview(),
    ]);
    return Response.json(
      {
        data: rows,
        meta,
        stats: overview.stats,
        types: { known: overview.knownTypes, registered: overview.registeredTypes, present: overview.presentTypes },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
  { permission: "jobs.view" },
);
