import { apiCreated, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { db } from "@/lib/db";

import { attributeValueInputSchema } from "@/features/attributes/schemas";
import { addAttributeValue } from "@/features/attributes/service";

/**
 * POST /api/admin/attributes/:id/values { label, value?, colorHex?, position?, isActive? }   (attributes.manage)
 * `value` defaults to a slug of the label; COLOR attributes require `colorHex`.
 */
export const POST = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const input = await parseJsonBody(req, attributeValueInputSchema);
    const value = await db.$transaction((tx) => addAttributeValue(tx, params.id, input, actor, { ip, userAgent: req.headers.get("user-agent") }));
    await invalidatePublic(listTagsFor("attributeValue"));
    return apiCreated(value);
  },
  { permission: "attributes.manage" },
);
