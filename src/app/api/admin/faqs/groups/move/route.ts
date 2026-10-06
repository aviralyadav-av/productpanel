import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { faqGroupDeleteSchema } from "@/features/faqs/schemas";
import { deleteFaqGroup } from "@/features/faqs/service";

/**
 * PUT /api/admin/faqs/groups/move { group, moveTo } -> { data: { moved, from, to } } (faqs.manage)
 * This is "delete a group": a group is a label on its questions, so removing
 * one only ever MOVES them - there is no request shape here that deletes
 * content as a side effect of tidying up a heading.
 */
export const PUT = withAdminApi(
  async ({ req, actor }) => {
    const input = await parseJsonBody(req, faqGroupDeleteSchema);
    const result = await deleteFaqGroup(input, actor);
    await invalidatePublic(listTagsFor("faq"));
    return apiOk(result);
  },
  { permission: "faqs.manage" },
);
