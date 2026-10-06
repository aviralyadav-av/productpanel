import { apiOk, withAdminApi } from "@/lib/api/admin";
import { badRequest } from "@/lib/api/errors";
import { getSettingBoolean } from "@/lib/settings";

import { previewTokenSchema } from "@/features/products/schemas";
import { createProductPreviewLink } from "@/features/products/service";

/**
 * POST /api/admin/products/:id/preview-token { ttlSeconds? }   (products.view, blueprint E6)
 * → { token, expiresAt, url } where url = ${storefront.base_url}/p/<slug>?preview=<token>
 * The body is optional, so it is read as text rather than through parseJsonBody.
 */
export const POST = withAdminApi<{ id: string }>(
  async ({ req, params }) => {
    if (!(await getSettingBoolean("storefront.preview_enabled"))) throw badRequest("Preview links are disabled in settings.");
    const raw = await req.text();
    const parsed = previewTokenSchema.safeParse(raw ? JSON.parse(raw) : {});
    if (!parsed.success) throw badRequest("ttlSeconds must be between 60 and 3600.");
    return apiOk(await createProductPreviewLink(params.id, parsed.data.ttlSeconds));
  },
  { permission: "products.view" },
);
