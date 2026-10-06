import { apiOk, withAdminApi } from "@/lib/api/admin";

import { listAllowedReports } from "@/features/reports/queries";

/**
 * GET /api/admin/reports    (reports.view)
 *
 * The reports this actor may open, with their columns, filters and default
 * sort - enough for a client to build a report picker without hard-coding the
 * catalogue. D14: a report the actor lacks a `requires` code for is omitted
 * here exactly as it is omitted from the index page, so the list can never
 * advertise a report that would 403.
 */
export const GET = withAdminApi(
  async ({ actor }) => apiOk({ reports: listAllowedReports(actor) }),
  { permission: "reports.view" },
);
