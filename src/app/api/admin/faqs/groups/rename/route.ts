import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { faqGroupRenameSchema } from "@/features/faqs/schemas";
import { renameFaqGroup } from "@/features/faqs/service";

/**
 * PUT /api/admin/faqs/groups/rename { from, to } -> { data: { moved, from, to, merged } } (faqs.manage)
 * Renaming onto an existing group MERGES into it: the renamed questions follow
 * the destination's own, so an order the operator set before is not shuffled.
 */
export const PUT = withAdminApi(
  async ({ req, actor }) => {
    const input = await parseJsonBody(req, faqGroupRenameSchema);
    const result = await renameFaqGroup(input, actor);
    await invalidatePublic(listTagsFor("faq"));
    return apiOk(result);
  },
  { permission: "faqs.manage" },
);
