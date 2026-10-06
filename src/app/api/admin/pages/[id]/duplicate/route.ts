import { apiCreated, withAdminApi } from "@/lib/api/admin";
import { can } from "@/lib/auth/guards";

import { duplicatePage } from "@/features/pages/service";

/** POST /api/admin/pages/:id/duplicate -> 201 { data: CmsPage } - a DRAFT copy with a suffixed slug (pages.manage) */
export const POST = withAdminApi<{ id: string }>(
  async ({ actor, params }) => {
    const row = await duplicatePage(params.id, { actor, canPublish: can(actor, "pages.publish") });
    return apiCreated(row);
  },
  { permission: "pages.manage" },
);
