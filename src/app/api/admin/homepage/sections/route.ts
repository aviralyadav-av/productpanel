import { apiCreated, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic } from "@/lib/cache-tags";
import { scheduleContentExpiry } from "@/lib/queue/handlers/platform";

import { listHomeSections } from "@/features/content/homepage/queries";
import { sectionCreateSchema, sectionReorderSchema } from "@/features/content/homepage/schemas";
import { createSection, reorderSections } from "@/features/content/homepage/service";

/**
 * GET  /api/admin/homepage/sections   the board rows in storefront order   (homepage.view)
 * POST /api/admin/homepage/sections   add a section of a registry type      (homepage.manage)
 * PUT  /api/admin/homepage/sections   { ids } - the whole order at once     (homepage.manage)
 *
 * PUT lives here as well as on /reorder because blueprint 5.2 names
 * `GET|PUT /api/admin/homepage/sections`; both accept the same body.
 */
export const GET = withAdminApi(async () => apiOk(await listHomeSections()), { permission: "homepage.view" });

export const POST = withAdminApi(
  async ({ req, actor }) => {
    const input = await parseJsonBody(req, sectionCreateSchema);
    const section = await createSection(input, actor);
    await invalidatePublic(["content"]);
    await scheduleContentExpiry();
    return apiCreated(section);
  },
  { permission: "homepage.manage" },
);

export const PUT = withAdminApi(
  async ({ req, actor }) => {
    const { ids } = await parseJsonBody(req, sectionReorderSchema);
    const result = await reorderSections(ids, actor);
    await invalidatePublic(["content"]);
    return apiOk(result);
  },
  { permission: "homepage.manage" },
);
