import { notFound } from "@/lib/api/errors";
import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { can } from "@/lib/auth/guards";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { getPageEditor } from "@/features/pages/queries";
import { pageFormSchema } from "@/features/pages/schemas";
import { deletePage, updatePage } from "@/features/pages/service";

/**
 * GET    /api/admin/pages/:id -> { data: PageEditorData }        (pages.view)
 * PUT    /api/admin/pages/:id  body = PageFormInput -> { data }   (pages.manage; status change needs pages.publish)
 * DELETE /api/admin/pages/:id -> 204; 409 for system pages        (pages.manage)
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const page = await getPageEditor(params.id);
    if (!page) throw notFound("Page");
    return apiOk(page);
  },
  { permission: "pages.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, actor, params }) => {
    const input = await parseJsonBody(req, pageFormSchema);
    const row = await updatePage(params.id, input, { actor, canPublish: can(actor, "pages.publish") });
    await invalidatePublic(listTagsFor("page"));
    return apiOk(row);
  },
  { permission: "pages.manage" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ actor, params }) => {
    await deletePage(params.id, { actor, canPublish: can(actor, "pages.publish") });
    await invalidatePublic(listTagsFor("page"));
    return apiNoContent();
  },
  { permission: "pages.manage" },
);
