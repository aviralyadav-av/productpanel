import { parseListQuery, withAdminApi } from "@/lib/api/admin";
import { parseExportFormat } from "@/lib/export";

import { exportCustomers } from "@/features/customers/export";
import { CUSTOMER_SORTS, parseCustomerFilters } from "@/features/customers/filters";

/** GET /api/admin/customers/export?format=csv|xlsx|print&<same filters as the list>&id=...(optional, from the bulk bar)   (customers.view; audited with filter + row count) */
export const GET = withAdminApi(
  async ({ searchParams, actor, ip }) => {
    const query = parseListQuery(searchParams, { defaultSort: "createdAt", defaultOrder: "desc", allowedSorts: CUSTOMER_SORTS });
    return exportCustomers({
      format: parseExportFormat(searchParams.get("format")),
      params: query,
      filters: parseCustomerFilters(query.raw),
      ids: searchParams.getAll("id").slice(0, 500),
      actor,
      ip,
    });
  },
  { permission: "customers.view" },
);
