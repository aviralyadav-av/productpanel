import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { faqGroupsReorderSchema } from "@/features/faqs/schemas";
import { reorderFaqGroups } from "@/features/faqs/service";

/**
 * PUT /api/admin/faqs/groups/reorder { groups } -> { data: { moved } } (faqs.manage)
 * The storefront lists groups in the order of their first question's position,
 * so reordering groups renumbers every row - that is the only representation
 * `Faq.position` has for group order.
 */
export const PUT = withAdminApi(
  async ({ req, actor }) => {
    const input = await parseJsonBody(req, faqGroupsReorderSchema);
    const result = await reorderFaqGroups(input.groups, actor);
    await invalidatePublic(listTagsFor("faq"));
    return apiOk(result);
  },
  { permission: "faqs.manage" },
);
