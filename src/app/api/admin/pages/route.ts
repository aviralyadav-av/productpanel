import { apiCreated, apiList, parseJsonBody, parseListQuery, withAdminApi } from "@/lib/api/admin";
import { can } from "@/lib/auth/guards";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { listPages } from "@/features/pages/queries";
import { PAGE_SORTS, pageFormSchema, parsePageListFilters, resolvePageSort } from "@/features/pages/schemas";
import { createPage } from "@/features/pages/service";

/**
 * GET  /api/admin/pages?status&template&system=1|0&footer=1|0&authorId&q&sort&order&page&pageSize  (pages.view)
 *      -> { data: PageListRow[], meta }  (+ X-Status-Counts header as JSON)
 * POST /api/admin/pages  body = PageFormInput  (pages.manage; PUBLISHED needs pages.publish) -> 201 { data: CmsPage }
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, { defaultSort: "updatedAt", allowedSorts: PAGE_SORTS });
    const result = await listPages({ ...query, sort: resolvePageSort(query.sort) }, parsePageListFilters(searchParams));
    return apiList(result.rows, result.meta);
  },
  { permission: "pages.view" },
);

export const POST = withAdminApi(
  async ({ req, actor }) => {
    const input = await parseJsonBody(req, pageFormSchema);
    const row = await createPage(input, { actor, canPublish: can(actor, "pages.publish") });
    await invalidatePublic(listTagsFor("page"));
    return apiCreated(row);
  },
  { permission: "pages.manage" },
);
