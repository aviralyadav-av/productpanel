import { apiOk, withAdminApi } from "@/lib/api/admin";
import { getSettingString } from "@/lib/settings";

import { storefrontBlogUrl } from "@/features/blog/schemas";
import { issueBlogPreviewToken } from "@/features/blog/service";

/**
 * POST /api/admin/blog/:id/preview-token (blog.view, E6)
 * -> { data: { token, expiresAt, url } } with url = <storefront.base_url>/blog/<slug>?preview=<token>
 */
export const POST = withAdminApi<{ id: string }>(
  async ({ actor, params }) => {
    const [{ token, expiresAt, slug }, baseUrl] = await Promise.all([issueBlogPreviewToken(params.id, actor), getSettingString("storefront.base_url")]);
    const url = baseUrl ? `${storefrontBlogUrl(baseUrl, slug)}?preview=${encodeURIComponent(token)}` : null;
    return apiOk({ token, expiresAt, url });
  },
  { permission: "blog.view", rateLimit: { limit: 60, windowMs: 60_000 } },
);
