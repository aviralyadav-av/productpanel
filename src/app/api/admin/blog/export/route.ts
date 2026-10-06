import { withAdminApi } from "@/lib/api/admin";
import { writeAudit } from "@/lib/audit";
import { exportRows, parseExportFormat } from "@/lib/export";

import { BLOG_EXPORT_COLUMNS, blogExportRows } from "@/features/blog/queries";
import { parseBlogListFilters } from "@/features/blog/schemas";

/** GET /api/admin/blog/export?format=csv|xlsx&status&categoryId&tag&featured&authorId&q (blog.view) - audited (D13). */
export const GET = withAdminApi(
  async ({ searchParams, actor, ip, req }) => {
    const format = parseExportFormat(searchParams.get("format"));
    const filters = parseBlogListFilters(searchParams);
    const rows = await blogExportRows(filters);
    return exportRows({
      format,
      filename: "blog-posts",
      title: "Blog posts",
      columns: BLOG_EXPORT_COLUMNS,
      rows,
      onComplete: (rowCount) =>
        writeAudit({
          actor,
          action: "blog.export",
          entityType: "BlogPost",
          summary: `Exported ${rowCount} blog posts as ${format.toUpperCase()} (filters: ${JSON.stringify(filters)}).`,
          ip,
          userAgent: req.headers.get("user-agent"),
        }),
    });
  },
  { permission: "blog.view" },
);
