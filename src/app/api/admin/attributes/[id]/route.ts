import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { db } from "@/lib/db";

import { getAttributeDetail } from "@/features/attributes/queries";
import { attributePatchSchema } from "@/features/attributes/schemas";
import { deleteAttribute, updateAttribute } from "@/features/attributes/service";

/**
 * GET    /api/admin/attributes/:id       attribute + values (with usage) + usage   (attributes.view)
 * PUT    /api/admin/attributes/:id       partial update; `code` immutable          (attributes.manage)
 * DELETE /api/admin/attributes/:id       204, or 409 with `usage` while in use      (attributes.manage)
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const detail = await getAttributeDetail(params.id);
    if (!detail) throw notFound("Attribute");
    return apiOk(detail);
  },
  { permission: "attributes.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const patch = await parseJsonBody(req, attributePatchSchema);
    const result = await db.$transaction((tx) => updateAttribute(tx, params.id, patch, actor, { ip, userAgent: req.headers.get("user-agent") }));
    await invalidatePublic(listTagsFor("attribute"));
    return apiOk(result);
  },
  { permission: "attributes.manage" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const result = await db.$transaction((tx) => deleteAttribute(tx, params.id, actor, { ip, userAgent: req.headers.get("user-agent") }));
    if (!result.deleted) {
      return Response.json(
        {
          error: {
            code: "CONFLICT",
            message: `"${result.name}" is in use and cannot be deleted.`,
            details: {
              categories: String(result.usage.categories.length),
              products: String(result.usage.products),
              variants: String(result.usage.variants),
            },
          },
          inUse: true,
          usage: result.usage,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    await invalidatePublic(listTagsFor("attribute"));
    return apiNoContent();
  },
  { permission: "attributes.manage" },
);
