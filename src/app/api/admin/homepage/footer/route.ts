import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic } from "@/lib/cache-tags";

import { getFooterEditor } from "@/features/content/homepage/queries";
import { footerFormSchema } from "@/features/content/homepage/schemas";
import { saveFooter } from "@/features/content/homepage/service";

/**
 * GET /api/admin/homepage/footer   (homepage.view)
 * PUT /api/admin/homepage/footer   (homepage.manage)
 *
 * FooterConfig only. The footer's LINK COLUMNS are the NavigationMenus
 * footer-1..3 and are edited through /api/admin/navigation; `GET /api/v1/footer`
 * joins the two for the website.
 */
export const GET = withAdminApi(async () => apiOk(await getFooterEditor()), { permission: "homepage.view" });

export const PUT = withAdminApi(
  async ({ req, actor }) => {
    const values = await parseJsonBody(req, footerFormSchema);
    const footer = await saveFooter(values, actor);
    await invalidatePublic(["content"]);
    return apiOk(footer);
  },
  { permission: "homepage.manage" },
);
