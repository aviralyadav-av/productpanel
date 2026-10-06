import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { blogStatusInputSchema } from "@/features/blog/schemas";
import { setBlogPostStatus } from "@/features/blog/service";

/**
 * PUT /api/admin/blog/:id/status { status: DRAFT|PUBLISHED|SCHEDULED|ARCHIVED, publishedAt? } -> { data: BlogPost } (blog.publish)
 * SCHEDULED requires a future publishedAt; PUBLISHED with a future date is stored as SCHEDULED.
 */
export const PUT = withAdminApi<{ id: string }>(
  async ({ req, actor, params }) => {
    const input = await parseJsonBody(req, blogStatusInputSchema);
    const row = await setBlogPostStatus(params.id, input, { actor, canPublish: true });
    await invalidatePublic(listTagsFor("blogPost"));
    return apiOk(row);
  },
  { permission: "blog.publish" },
);
