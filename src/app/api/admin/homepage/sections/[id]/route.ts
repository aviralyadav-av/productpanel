import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";
import { invalidatePublic } from "@/lib/cache-tags";
import { scheduleContentExpiry } from "@/lib/queue/handlers/platform";

import { getSectionEditor } from "@/features/content/homepage/queries";
import { sectionUpdateSchema } from "@/features/content/homepage/schemas";
import { deleteSection, updateSection } from "@/features/content/homepage/service";

/**
 * GET    /api/admin/homepage/sections/:id   editor payload with hydrated media and entity chips   (homepage.view)
 * PUT    /api/admin/homepage/sections/:id   { common, payload } - the payload is validated against
 *                                            the type's own registry schema, rich text sanitised
 * DELETE /api/admin/homepage/sections/:id   removes the section and its blocks                   (homepage.manage)
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const editor = await getSectionEditor(params.id);
    if (!editor) throw notFound("Section");
    return apiOk(editor);
  },
  { permission: "homepage.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor }) => {
    const values = await parseJsonBody(req, sectionUpdateSchema);
    const section = await updateSection(params.id, values, actor);
    await invalidatePublic(["content"]);
    await scheduleContentExpiry();
    return apiOk(section);
  },
  { permission: "homepage.manage" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ params, actor }) => {
    const result = await deleteSection(params.id, actor);
    await invalidatePublic(["content"]);
    return apiOk(result);
  },
  { permission: "homepage.manage" },
);
