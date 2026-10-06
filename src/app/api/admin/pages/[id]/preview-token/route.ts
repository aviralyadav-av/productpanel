import { apiOk, withAdminApi } from "@/lib/api/admin";
import { getSettingString } from "@/lib/settings";

import { storefrontPageUrl } from "@/features/pages/schemas";
import { issuePagePreviewToken } from "@/features/pages/service";

/**
 * POST /api/admin/pages/:id/preview-token  (pages.view, E6)
 * -> { data: { token, expiresAt, url } } where url = <storefront.base_url>/pages/<slug>?preview=<token>
 * The token is an HMAC over page:<id>:<exp>, valid ≤ 1 h; the public GET verifies it and bypasses the status filter.
 */
export const POST = withAdminApi<{ id: string }>(
  async ({ actor, params }) => {
    const [{ token, expiresAt, slug }, baseUrl] = await Promise.all([issuePagePreviewToken(params.id, actor), getSettingString("storefront.base_url")]);
    const url = baseUrl ? `${storefrontPageUrl(baseUrl, slug)}?preview=${encodeURIComponent(token)}` : null;
    return apiOk({ token, expiresAt, url });
  },
  { permission: "pages.view", rateLimit: { limit: 60, windowMs: 60_000 } },
);
