import { apiList, withAdminApi } from "@/lib/api/admin";
import { forbiddenError, notFound } from "@/lib/api/errors";
import { can } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import { toIstDayParam } from "@/components/shared/date-range";
import { EXPORT_PAGE_SIZE, exportRows, paginateAll, parseExportFormat } from "@/lib/export";

import { resolveColumns } from "@/features/reports/define";
import { toExportColumns, toExportRow } from "@/features/reports/export-columns";
import { getReport, isReportKey } from "@/features/reports/registry";
import { filtersToParams, parseReportParams } from "@/features/reports/schemas";

/**
 * GET /api/admin/reports/:report                        (reports.view + the report's own `requires`)
 *   ?range=|from=&to=  &sort=&order=&page=&pageSize=  &<the report's filters>
 *   &format=json (default) | csv | xlsx | print
 *
 * JSON returns one page in the standard list envelope with the range totals
 * and the chart in `meta`, so a client gets the same payload the page renders.
 *
 * The three file formats stream through src/lib/export: rows are pulled from
 * the report in pages of 5,000 (§11.28 - reports never `findMany()` without a
 * take) and the whole range is written, not just the page the operator was
 * looking at. Export needs `reports.export` on top of the view permission and
 * is audited with the filters and the final row count (D13); the row count is
 * only known once streaming has finished, which is what `onComplete` is for.
 * Formula-injection quoting is entirely src/lib/export's job (D15).
 */
export const GET = withAdminApi<{ report: string }>(
  async ({ actor, params, searchParams, ip }) => {
    if (!isReportKey(params.report)) throw notFound("Report");
    const definition = getReport(params.report);

    // `requires` is an AND of codes; can() treats a list as any-of.
    for (const code of definition.requires) {
      if (!can(actor, code)) throw forbiddenError(`This report also requires "${code}".`);
    }

    const runParams = parseReportParams(definition, searchParams);
    // Columns can depend on the request (the refunds report regroups), so the
    // JSON payload and the file both describe the view that was asked for.
    const columns = resolveColumns(definition, runParams);
    const rawFormat = searchParams.get("format");

    if (!rawFormat || rawFormat === "json") {
      const result = await definition.run(runParams);
      // The list envelope carries the page; the range totals, the chart and the
      // definition note ride along in meta, because a client rendering its own
      // table needs the same context the page shows above the rows.
      const meta = {
        ...result.meta,
        totals: result.totals,
        chart: result.chart,
        note: result.note ?? null,
        columns,
        range: { from: runParams.range.from, to: runParams.range.to, label: runParams.range.label },
      };
      return apiList(result.rows, meta);
    }

    if (!can(actor, "reports.export")) throw forbiddenError("Exporting reports requires reports.export.");

    const format = parseExportFormat(rawFormat);
    const filters = filtersToParams(runParams.filters);
    const from = toIstDayParam(runParams.range.from);
    const to = toIstDayParam(runParams.range.to);

    return exportRows({
      format,
      filename: `${definition.key}-report-${from}-to-${to}`,
      title: `${definition.title} — ${runParams.range.label}`,
      columns: toExportColumns(columns),
      rows: paginateAll(
        (skip, take) => definition.exportPage(runParams, skip, take),
        { pageSize: EXPORT_PAGE_SIZE, map: (row) => toExportRow(columns, row) },
      ),
      onComplete: (rowCount) =>
        writeAudit({
          actor,
          action: "report.export",
          entityType: "report",
          entityId: definition.key,
          entityLabel: definition.title,
          summary: `Exported the ${definition.title} report (${from} to ${to}) as ${format.toUpperCase()}: ${rowCount} row${rowCount === 1 ? "" : "s"}.`,
          diff: { report: definition.key, from, to, sort: runParams.sort, order: runParams.order, filters, rowCount },
          ip,
        }),
    });
  },
  { permission: "reports.view" },
);
