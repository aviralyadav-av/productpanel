import { withAdminApi } from "@/lib/api/admin";
import { writeAudit } from "@/lib/audit";
import { exportRows, parseExportFormat } from "@/lib/export";

import { FAQ_EXPORT_COLUMNS, faqExportRows } from "@/features/faqs/queries";
import { parseFaqListFilters } from "@/features/faqs/schemas";

/** GET /api/admin/faqs/export?format=csv|xlsx&q&group&enabled&featured (faqs.view) - audited (D13). */
export const GET = withAdminApi(
  async ({ searchParams, actor, ip, req }) => {
    const format = parseExportFormat(searchParams.get("format"));
    const filters = parseFaqListFilters(searchParams);
    const rows = await faqExportRows(filters);
    return exportRows({
      format,
      filename: "faqs",
      title: "FAQs",
      columns: FAQ_EXPORT_COLUMNS,
      rows,
      onComplete: (rowCount) =>
        writeAudit({
          actor,
          action: "faq.export",
          entityType: "Faq",
          summary: `Exported ${rowCount} FAQs as ${format.toUpperCase()} (filters: ${JSON.stringify(filters)}).`,
          ip,
          userAgent: req.headers.get("user-agent"),
        }),
    });
  },
  { permission: "faqs.view" },
);
