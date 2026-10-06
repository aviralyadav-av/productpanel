import { apiCreated, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { getFaqBoard } from "@/features/faqs/queries";
import { faqFormSchema, parseFaqListFilters } from "@/features/faqs/schemas";
import { createFaq } from "@/features/faqs/service";

/**
 * GET  /api/admin/faqs?q&group&enabled=1|0&featured=1|0  (faqs.view)
 *      -> { data: FaqBoardData } - grouped, in storefront order, no pagination
 *      (the whole set is a few dozen rows and the order only makes sense whole).
 * POST /api/admin/faqs { question, answer, group?, enabled?, isFeatured? } (faqs.manage)
 *      -> 201 { data: Faq } appended to the end of its group.
 */
export const GET = withAdminApi(async ({ searchParams }) => apiOk(await getFaqBoard(parseFaqListFilters(searchParams))), { permission: "faqs.view" });

export const POST = withAdminApi(
  async ({ req, actor }) => {
    const input = await parseJsonBody(req, faqFormSchema);
    const row = await createFaq(input, actor);
    await invalidatePublic(listTagsFor("faq"));
    return apiCreated(row);
  },
  { permission: "faqs.manage" },
);
