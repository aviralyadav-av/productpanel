import { apiOk, withAdminApi } from "@/lib/api/admin";
import { can } from "@/lib/auth/guards";
import { parseExportFormat } from "@/lib/export";

import {
  loadDashboardCharts,
  loadDashboardKpis,
  rangeInfo,
  redactCharts,
  redactSnapshot,
  resolveDashboardRange,
} from "@/features/dashboard/data";
import { dashboardAlerts } from "@/features/dashboard/queries";
import { exportDashboard } from "@/features/dashboard/export";

/**
 * GET /api/admin/dashboard                                    (dashboard.view)
 *   ?range=today|yesterday|7d|30d|this_month|last_month|this_year
 *   | ?from=YYYY-MM-DD&to=YYYY-MM-DD                          (custom span, IST)
 *   &format=json (default) | csv | xlsx | print
 *
 * JSON returns exactly what the page renders: the KPI tiles, the redacted
 * snapshot, the chart series and the alert list. The file formats hand the
 * same figures to src/lib/export as one tall `section / metric / period /
 * count / amount` sheet — a dashboard is many small tables, and one sheet
 * with a section column survives CSV, pivots in Excel and prints readably.
 *
 * There is no `dashboard.export` permission and none is invented here:
 * `dashboard.view` opens the page, and every row of the response — JSON or
 * file — is filtered through the actor's module permissions exactly as the
 * screen filters its widgets (D14), so an export can never carry a number the
 * page would have withheld.
 */
export const GET = withAdminApi(
  async ({ actor, searchParams, ip }) => {
    const range = resolveDashboardRange(searchParams);
    const allowed = (permission: string) => can(actor, permission);
    const rawFormat = searchParams.get("format");

    if (rawFormat && rawFormat !== "json") {
      return exportDashboard({
        format: parseExportFormat(rawFormat),
        range,
        actor,
        allowed,
        ip,
      });
    }

    const [kpis, charts, alerts] = await Promise.all([
      loadDashboardKpis(range),
      loadDashboardCharts(range),
      dashboardAlerts(),
    ]);

    return apiOk({
      range: rangeInfo(range),
      kpis: {
        tiles: kpis.tiles.filter((tile) => allowed(tile.permission)),
        snapshot: redactSnapshot(kpis.snapshot, allowed),
      },
      charts: redactCharts(charts, allowed),
      alerts: alerts.filter((alert) => allowed(alert.permission)),
    });
  },
  { permission: "dashboard.view" },
);
