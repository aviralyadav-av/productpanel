import { withAdminApi } from "@/lib/api/admin";
import { writeAudit } from "@/lib/audit";
import { exportRows, parseExportFormat } from "@/lib/export";

import { PAGE_EXPORT_COLUMNS, pageExportRows } from "@/features/pages/queries";
import { parsePageListFilters } from "@/features/pages/schemas";

/** GET /api/admin/pages/export?format=csv|xlsx&status&template&system&footer&authorId&q (pages.view) - audited (D13). */
export const GET = withAdminApi(
  async ({ searchParams, actor, ip, req }) => {
    const format = parseExportFormat(searchParams.get("format"));
    const filters = parsePageListFilters(searchParams);
    const rows = await pageExportRows(filters);
    return exportRows({
      format,
      filename: "pages",
      title: "CMS pages",
      columns: PAGE_EXPORT_COLUMNS,
      rows,
      onComplete: (rowCount) =>
        writeAudit({
          actor,
          action: "page.export",
          entityType: "CmsPage",
          summary: `Exported ${rowCount} pages as ${format.toUpperCase()} (filters: ${JSON.stringify(filters)}).`,
          ip,
          userAgent: req.headers.get("user-agent"),
        }),
    });
  },
  { permission: "pages.view" },
);
