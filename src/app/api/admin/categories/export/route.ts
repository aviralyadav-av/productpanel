import { withAdminApi } from "@/lib/api/admin";
import { writeAudit } from "@/lib/audit";
import { exportRows, parseExportFormat } from "@/lib/export";

import { categoryExportRows, CATEGORY_EXPORT_COLUMNS } from "@/features/categories/queries";

/**
 * GET /api/admin/categories/export?format=csv|xlsx   (categories.view)
 *
 * Depth-first in tree order: path, name, slug, depth, active, featured and
 * both product counts. The export is audited like every other (D13).
 */
export const GET = withAdminApi(
  async ({ searchParams, actor, ip, req }) => {
    const format = parseExportFormat(searchParams.get("format"));
    const rows = await categoryExportRows();
    return exportRows({
      format,
      filename: "categories",
      title: "Categories",
      columns: CATEGORY_EXPORT_COLUMNS,
      rows,
      onComplete: (rowCount) =>
        writeAudit({
          actor,
          action: "category.export",
          entityType: "Category",
          summary: `Exported ${rowCount} categories as ${format.toUpperCase()}`,
          ip,
          userAgent: req.headers.get("user-agent"),
        }),
    });
  },
  { permission: "categories.view" },
);
