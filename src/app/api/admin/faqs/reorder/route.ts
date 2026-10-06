import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { faqReorderSchema } from "@/features/faqs/schemas";
import { reorderFaqs } from "@/features/faqs/service";

/**
 * PUT /api/admin/faqs/reorder { group, ids } -> { data: { moved, group } } (faqs.manage)
 * `ids` is the FULL order of that group; ids from another group are a 422, so
 * a stale board cannot silently reshuffle questions it could not see.
 */
export const PUT = withAdminApi(
  async ({ req, actor }) => {
    const input = await parseJsonBody(req, faqReorderSchema);
    const result = await reorderFaqs(input, actor);
    await invalidatePublic(listTagsFor("faq"));
    return apiOk(result);
  },
  { permission: "faqs.manage" },
);
