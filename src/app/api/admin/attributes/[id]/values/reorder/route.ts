import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { db } from "@/lib/db";

import { reorderValuesSchema } from "@/features/attributes/schemas";
import { reorderAttributeValues } from "@/features/attributes/service";

/** PUT /api/admin/attributes/:id/values/reorder { valueIds: [...] }   (attributes.manage) */
export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const { valueIds } = await parseJsonBody(req, reorderValuesSchema);
    const result = await db.$transaction((tx) => reorderAttributeValues(tx, params.id, valueIds, actor, { ip, userAgent: req.headers.get("user-agent") }));
    await invalidatePublic(listTagsFor("attributeValue"));
    return apiOk(result);
  },
  { permission: "attributes.manage" },
);
