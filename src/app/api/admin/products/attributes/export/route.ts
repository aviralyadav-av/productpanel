import { withAdminApi } from "@/lib/api/admin";
import { badRequest } from "@/lib/api/errors";

import { buildAttributeCsv } from "@/features/products/attribute-csv";

/**
 * GET /api/admin/products/attributes/export?category=<id>   (products.view, blueprint A7)
 * CSV: product_id, slug, title, then one column per effective attribute code.
 * The same file, edited, is what /attributes/import accepts.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const categoryId = searchParams.get("category");
    if (!categoryId) throw badRequest("Pass ?category=<id>.");
    const result = await buildAttributeCsv(categoryId);
    return new Response(result.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  },
  { permission: "products.view" },
);
