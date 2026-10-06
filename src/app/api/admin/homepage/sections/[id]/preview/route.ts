import { apiOk, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { getSectionPreview } from "@/features/content/homepage/queries";

/**
 * GET /api/admin/homepage/sections/:id/preview   (homepage.view)
 *
 * One section through the SAME resolver `/api/v1/home` uses, whatever its
 * schedule state, so an operator can see what a scheduled or expired section
 * would contain. A resolver failure comes back as `error` with `items: []`
 * rather than a 500 - a broken payload is an editing problem, not an outage.
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const preview = await getSectionPreview(params.id);
    if (!preview) throw notFound("Section");
    return apiOk(preview);
  },
  { permission: "homepage.view" },
);
