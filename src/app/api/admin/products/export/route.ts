import { parseListQuery, withAdminApi } from "@/lib/api/admin";
import { parseExportFormat } from "@/lib/export";

import { exportProducts } from "@/features/products/export";
import { PRODUCT_SORTS, parseProductFilters } from "@/features/products/filters";

/** GET /api/admin/products/export?format=csv|xlsx|print&<same filters as the list>   (products.view; audited with filter + row count) */
export const GET = withAdminApi(
  async ({ searchParams, actor, ip }) => {
    const query = parseListQuery(searchParams, { defaultSort: "updatedAt", defaultOrder: "desc", allowedSorts: PRODUCT_SORTS });
    return exportProducts({
      format: parseExportFormat(searchParams.get("format")),
      params: query,
      filters: parseProductFilters(query.raw),
      actor,
      ip,
    });
  },
  { permission: "products.view" },
);
