import { parseListQuery, withAdminApi } from "@/lib/api/admin";

import { listEmailTemplates } from "@/features/email/queries";
import {
  parseTemplateFilters,
  resolveTemplateSort,
  TEMPLATE_SORTS,
} from "@/features/email/templates-schemas";

/**
 * GET /api/admin/email-templates?q=&active=1|0&sort=&order=&page=&pageSize=
 *
 * The list envelope plus `activeCount`, so a client can render the "Active /
 * Disabled" tabs without a second call. Bodies are omitted; fetch one
 * template to get its HTML.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, {
      defaultSort: "key",
      defaultOrder: "asc",
      allowedSorts: TEMPLATE_SORTS,
    });
    const filters = parseTemplateFilters(query.raw);
    const result = await listEmailTemplates({ ...query, sort: resolveTemplateSort(query.sort) }, filters);

    return Response.json(
      { data: result.rows, meta: result.meta, activeCount: result.activeCount },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
  { permission: "email_templates.view" },
);
