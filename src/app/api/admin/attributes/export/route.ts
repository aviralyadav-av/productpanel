import { withAdminApi } from "@/lib/api/admin";
import { writeAudit } from "@/lib/audit";
import { exportRows, parseExportFormat } from "@/lib/export";

import { ATTRIBUTE_EXPORT_COLUMNS, attributeExportRows } from "@/features/attributes/queries";
import { parseAttributeListFilters } from "@/features/attributes/schemas";

/** GET /api/admin/attributes/export?format=csv|xlsx&q&type&global&active   (attributes.view) */
export const GET = withAdminApi(
  async ({ searchParams, actor, ip, req }) => {
    const format = parseExportFormat(searchParams.get("format"));
    const rows = await attributeExportRows(parseAttributeListFilters(searchParams), (searchParams.get("q") ?? "").trim());
    return exportRows({
      format,
      filename: "attributes",
      title: "Attributes",
      columns: ATTRIBUTE_EXPORT_COLUMNS,
      rows,
      onComplete: (rowCount) =>
        writeAudit({
          actor,
          action: "attribute.export",
          entityType: "Attribute",
          summary: `Exported ${rowCount} attributes as ${format.toUpperCase()}`,
          ip,
          userAgent: req.headers.get("user-agent"),
        }),
    });
  },
  { permission: "attributes.view" },
);
