import { notFound } from "@/lib/api/errors";
import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { getFaq } from "@/features/faqs/queries";
import { faqPatchSchema } from "@/features/faqs/schemas";
import { deleteFaq, updateFaq } from "@/features/faqs/service";

/**
 * GET    /api/admin/faqs/:id -> { data: Faq }                                   (faqs.view)
 * PUT    /api/admin/faqs/:id { question?, answer?, group?, enabled?, isFeatured? } (faqs.manage)
 *        Partial by design: the board's enabled switch and featured star send one field.
 *        Moving a question to another group lands it at the end of that group.
 * DELETE /api/admin/faqs/:id -> { data: { id, question, group } }               (faqs.manage)
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const row = await getFaq(params.id);
    if (!row) throw notFound("FAQ");
    return apiOk(row);
  },
  { permission: "faqs.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, actor, params }) => {
    const patch = await parseJsonBody(req, faqPatchSchema);
    const row = await updateFaq(params.id, patch, actor);
    await invalidatePublic(listTagsFor("faq"));
    return apiOk(row);
  },
  { permission: "faqs.manage" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ actor, params }) => {
    const result = await deleteFaq(params.id, actor);
    await invalidatePublic(listTagsFor("faq"));
    return apiOk(result);
  },
  { permission: "faqs.manage" },
);
