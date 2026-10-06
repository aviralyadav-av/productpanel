import { apiCreated, parseJsonBody, parseListQuery, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { db } from "@/lib/db";

import { listAttributes } from "@/features/attributes/queries";
import { ATTRIBUTE_SORTS, attributeInputSchema, parseAttributeListFilters, resolveAttributeSort } from "@/features/attributes/schemas";
import { createAttribute } from "@/features/attributes/service";

/**
 * GET  /api/admin/attributes?q&type&global=1|0&active=1|0&sort&order&page&pageSize   (attributes.view)
 *      { data: AttributeListRow[], meta, counts }
 * POST /api/admin/attributes                                                          (attributes.manage)
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, { defaultSort: "position", defaultOrder: "asc", allowedSorts: ATTRIBUTE_SORTS });
    const result = await listAttributes({ ...query, sort: resolveAttributeSort(query.sort) }, parseAttributeListFilters(searchParams));
    return Response.json({ data: result.rows, meta: result.meta, counts: result.counts }, { headers: { "Cache-Control": "no-store" } });
  },
  { permission: "attributes.view" },
);

export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const input = await parseJsonBody(req, attributeInputSchema);
    const attribute = await db.$transaction((tx) => createAttribute(tx, input, actor, { ip, userAgent: req.headers.get("user-agent") }));
    await invalidatePublic(listTagsFor("attribute"));
    return apiCreated(attribute);
  },
  { permission: "attributes.manage" },
);
