import "dotenv/config";

import { db } from "@/lib/db";
import { cancelJob, enqueue, requeueJob } from "@/lib/queue";
import { registerAllJobHandlers } from "@/lib/queue/register-all";

import { getJobDetail, jobStatusCounts, jobsPageData, listJobRows } from "@/features/jobs/queries";
import { parseJobFilters } from "@/features/jobs/schemas";

/**
 * Read-side + requeue/cancel check for /admin/jobs:
 *
 *   node --env-file=.env --import tsx --import ./src/features/storefront/__checks__/stub-server-only.ts \
 *     src/features/jobs/__checks__/jobs-check.ts
 *
 * It deliberately does NOT call runPendingJobs(): draining the queue against a
 * live database would send real emails and touch real orders. The button that
 * does that is exercised by a human on the page; what is verified here is
 * everything around it - the page read model, the filters and the two state
 * transitions the sheet offers.
 *
 * The scratch job it creates is deleted at the end.
 */

const MARKER = `check_jobs_${Date.now()}`;

let failures = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failures += 1;
    console.error(`  FAIL  ${message}`);
  } else {
    console.log(`  ok    ${message}`);
  }
}

const LIST_PARAMS = { page: 1, pageSize: 25, skip: 0, sort: "createdAt", order: "desc" as const, q: "" };

async function main(): Promise<void> {
  registerAllJobHandlers();

  const page = await jobsPageData();
  assert(page.knownTypes.length > 0, `enums.ts knows ${page.knownTypes.length} job types`);
  assert(
    page.registeredTypes.every((type) => page.knownTypes.includes(type)),
    "every registered handler corresponds to a known type",
  );
  assert(page.recurring.length > 0, `the recurring schedule lists ${page.recurring.length} cadences`);
  assert(
    page.recurring.every((row) => (row.hasHandler ? row.nextExpectedAt !== null : row.nextExpectedAt === null)),
    "a cadence with no handler is reported as dormant",
  );
  console.log(
    `        handlers registered here: ${page.registeredTypes.length}/${page.knownTypes.length}; ` +
      `pending ${page.stats.byStatus.PENDING}, failed ${page.stats.byStatus.FAILED}, completed 24h ${page.stats.completed24h}`,
  );

  // A scratch job far in the future so no worker can claim it mid-check.
  const runAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const created = await enqueue("rate_limit.purge", { marker: MARKER }, { runAt, dedupeKey: MARKER });
  assert(!created.deduplicated, "the scratch job was created");

  try {
    const found = await listJobRows(LIST_PARAMS, parseJobFilters({ q: MARKER }));
    assert(found.rows.length === 1, `the dedupe-key search finds it (got ${found.rows.length})`);
    assert(found.rows[0]?.hasHandler === true, "rate_limit.purge has a handler registered here");

    const byId = await listJobRows(LIST_PARAMS, parseJobFilters({ q: created.id }));
    assert(byId.rows.length === 1, "searching by id finds exactly one job");

    const byType = await listJobRows(LIST_PARAMS, parseJobFilters({ type: "rate_limit.purge", q: MARKER }));
    assert(byType.rows.length === 1, "the type filter keeps it");

    const wrongType = await listJobRows(LIST_PARAMS, parseJobFilters({ type: "email.send", q: MARKER }));
    assert(wrongType.rows.length === 0, "the type filter excludes other types");

    const counts = await jobStatusCounts(parseJobFilters({ q: MARKER, status: "FAILED" }));
    assert(counts.PENDING === 1, "status counts drop the status filter so a tab never reads 0");

    const detail = await getJobDetail(created.id);
    assert(detail !== null, "the detail reader returns the job");
    assert(
      (detail?.payload as { marker?: string } | null)?.marker === MARKER,
      "the payload survives the round trip for the JSON viewer",
    );

    const requeued = await requeueJob(created.id);
    assert(requeued?.status === "PENDING", "requeue puts the job back to PENDING");
    assert(requeued?.attempts === 0, "requeue resets the attempt counter");

    assert(await cancelJob(created.id), "a PENDING job can be cancelled");
    const cancelled = await getJobDetail(created.id);
    assert(cancelled?.status === "CANCELLED", "the cancelled job reads back as CANCELLED");
    assert((await cancelJob(created.id)) === false, "cancelling twice is refused");
  } finally {
    await db.job.deleteMany({ where: { dedupeKey: MARKER } });
  }

  const gone = await listJobRows(LIST_PARAMS, parseJobFilters({ q: MARKER }));
  assert(gone.rows.length === 0, "the scratch job has been removed");

  if (failures > 0) {
    console.error(`\nFAILED with ${failures} problem(s).`);
    process.exitCode = 1;
    return;
  }
  console.log("\nPASSED");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
