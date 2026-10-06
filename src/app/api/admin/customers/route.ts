import { apiCreated, apiList, parseJsonBody, parseListQuery, withAdminApi } from "@/lib/api/admin";

import { CUSTOMER_SORTS, parseCustomerFilters } from "@/features/customers/filters";
import { listCustomers } from "@/features/customers/queries";
import { customerFormSchema } from "@/features/customers/schemas";
import { createCustomer } from "@/features/customers/service";

/**
 * GET  /api/admin/customers?q&segment&status&marketing&tags&from&to&range&sort&order&page&pageSize   (customers.view)
 * POST /api/admin/customers  body = customer form (+ optional address)                               (customers.create)
 *
 * The GET vocabulary is the one the admin list reads from its URL
 * (src/features/customers/filters.ts), so a filtered view replays verbatim.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, { defaultSort: "createdAt", defaultOrder: "desc", allowedSorts: CUSTOMER_SORTS });
    const result = await listCustomers(query, parseCustomerFilters(query.raw));
    return apiList(result.rows, result.meta);
  },
  { permission: "customers.view" },
);

export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const input = await parseJsonBody(req, customerFormSchema);
    return apiCreated(await createCustomer(input, actor, { ip }));
  },
  { permission: "customers.create" },
);
