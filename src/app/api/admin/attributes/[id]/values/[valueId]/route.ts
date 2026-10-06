import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { db } from "@/lib/db";

import { attributeValuePatchSchema } from "@/features/attributes/schemas";
import { deleteAttributeValue, updateAttributeValue } from "@/features/attributes/service";

/**
 * PUT    /api/admin/attributes/:id/values/:valueId   partial update                 (attributes.manage)
 * DELETE /api/admin/attributes/:id/values/:valueId   204, or 409 with usage counts  (attributes.manage)
 */
export const PUT = withAdminApi<{ id: string; valueId: string }>(
  async ({ req, params, actor, ip }) => {
    const patch = await parseJsonBody(req, attributeValuePatchSchema);
    const result = await db.$transaction((tx) =>
      updateAttributeValue(tx, params.id, params.valueId, patch, actor, { ip, userAgent: req.headers.get("user-agent") }),
    );
    await invalidatePublic(listTagsFor("attributeValue"));
    return apiOk(result);
  },
  { permission: "attributes.manage" },
);

export const DELETE = withAdminApi<{ id: string; valueId: string }>(
  async ({ req, params, actor, ip }) => {
    const result = await db.$transaction((tx) =>
      deleteAttributeValue(tx, params.id, params.valueId, actor, { ip, userAgent: req.headers.get("user-agent") }),
    );
    if (!result.deleted) {
      return Response.json(
        {
          error: {
            code: "CONFLICT",
            message: "This value is in use and cannot be deleted; deactivate it instead.",
            details: { products: String(result.usage.products), variants: String(result.usage.variants) },
          },
          inUse: true,
          usage: result.usage,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    await invalidatePublic(listTagsFor("attributeValue"));
    return apiNoContent();
  },
  { permission: "attributes.manage" },
);
