import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic } from "@/lib/cache-tags";

import { sectionReorderSchema } from "@/features/content/homepage/schemas";
import { reorderSections } from "@/features/content/homepage/service";

/**
 * POST /api/admin/homepage/sections/reorder { ids }   (homepage.manage)
 *
 * The full id list in the order the website should render them. Sections the
 * caller did not know about keep their relative order after the listed ones,
 * so a stale tab cannot silently push a section someone else just added to the
 * bottom of the page.
 */
export const POST = withAdminApi(
  async ({ req, actor }) => {
    const { ids } = await parseJsonBody(req, sectionReorderSchema);
    const result = await reorderSections(ids, actor);
    await invalidatePublic(["content"]);
    return apiOk(result);
  },
  { permission: "homepage.manage" },
);
