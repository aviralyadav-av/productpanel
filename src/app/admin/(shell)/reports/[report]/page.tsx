import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { can, requirePermission } from "@/lib/auth/guards";
import { REPORT_META } from "@/lib/enums";
import type { SearchParams } from "@/lib/list-params";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";

import { ReportChart } from "@/features/reports/components/report-chart";
import { resolveColumns } from "@/features/reports/define";
import { ReportTable } from "@/features/reports/components/report-table";
import { ReportToolbar } from "@/features/reports/components/report-toolbar";
import { ReportTotals } from "@/features/reports/components/report-totals";
import { resolveFilterRefs } from "@/features/reports/queries";
import { getReport, isReportKey, summarize } from "@/features/reports/registry";
import { hasReportFilters, parseReportParams } from "@/features/reports/schemas";

/** The report key is a static enum, so each report gets its own tab title. */
export async function generateMetadata({ params }: PageProps<"/admin/reports/[report]">): Promise<Metadata> {
  const { report } = await params;
  return { title: isReportKey(report) ? `${REPORT_META[report].label} report` : "Report" };
}

/**
 * /admin/reports/[report] (blueprint §1 Reports, §5.2, §11.27, §11.28, E4).
 *
 * One page renders all thirteen reports: the registry supplies the columns,
 * the filters, the chart and the rows, and everything on screen is derived
 * from the URL - range, filters, sort, page. That means a report someone sends
 * you in chat opens exactly as they saw it, and the export link is the same
 * query string with `&format=`.
 *
 * Permissions are checked twice over (D14): `reports.view` to be here at all,
 * then every code the report itself declares, so the seller-revenue report
 * cannot be reached by someone who may not see sellers.
 */
export default async function ReportDetailPage({ params, searchParams }: PageProps<"/admin/reports/[report]">) {
  const actor = await requirePermission("reports.view");

  const { report } = await params;
  if (!isReportKey(report)) notFound();

  const definition = getReport(report);
  // `requires` is an AND of codes; can() treats a list as any-of, so each code
  // is checked on its own.
  for (const code of definition.requires) await requirePermission(code);

  const query = (await searchParams) as SearchParams;
  const runParams = parseReportParams(definition, query);

  const [result, refs] = await Promise.all([
    definition.run(runParams),
    resolveFilterRefs(runParams.filters),
  ]);

  const summary = summarize(definition);
  const filtered = hasReportFilters(runParams.filters);

  return (
    <div className="space-y-4">
      <PageHeader
        title={definition.title}
        description={definition.about}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={"/admin/reports" as Route}>
              <ChevronLeft /> All reports
            </Link>
          </Button>
        }
      />

      <div className="surface overflow-hidden">
        <ReportToolbar
          report={summary}
          refs={refs}
          hasFilters={filtered}
          canExport={can(actor, "reports.export")}
        />
        <p className="text-muted-foreground px-4 py-2 text-[11px]">
          {runParams.range.label} &middot; {runParams.range.days} day
          {runParams.range.days === 1 ? "" : "s"} &middot; buckets and day filters are IST
        </p>
      </div>

      {result.totals.length > 0 ? <ReportTotals totals={result.totals} /> : null}

      {result.chart ? (
        <div className="surface p-4">
          <ReportChart chart={result.chart} />
        </div>
      ) : null}

      <ReportTable
        reportKey={definition.key}
        columns={resolveColumns(definition, runParams)}
        rows={result.rows}
        meta={result.meta}
        sort={runParams.sort}
        order={runParams.order}
        hasFilters={filtered}
      />

      {result.note ? <p className="text-muted-foreground text-xs leading-relaxed">{result.note}</p> : null}
    </div>
  );
}
