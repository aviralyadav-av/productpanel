import { apiOk, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";
import { db } from "@/lib/db";

import { getMediaUsage, totalUsageCount } from "@/features/media/usage";

/**
 * GET /api/admin/media/:id/usage  (media.view)
 *
 * `{ data: { inUse, count, usages: [{ type, relation, count, href, items }] } }`
 * - the same list the delete flow shows, for editors that want to warn before
 * swapping an image out.
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const exists = await db.mediaAsset.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!exists) throw notFound("Media asset");
    const usages = await getMediaUsage(params.id);
    return apiOk({ inUse: usages.length > 0, count: totalUsageCount(usages), usages });
  },
  { permission: "media.view" },
);
