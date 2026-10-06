import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";
import { invalidatePublic } from "@/lib/cache-tags";
import { db } from "@/lib/db";

import { getCategoryAttributesTab } from "@/features/categories/queries";
import { replaceCategoryAttributesSchema } from "@/features/categories/schemas";
import { replaceOwnCategoryAttributes } from "@/features/categories/service";

/**
 * GET /api/admin/categories/:id/attributes
 *   { effective: EffectiveAttribute[] (+ source name, usage), excluded, available }   (categories.view)
 *
 * PUT /api/admin/categories/:id/attributes
 *   { rows: [{ attributeId, isRequired, isFilterable, isVariant, showInSpecs, inheritToChildren, isExcluded, position }] }
 *   Replaces this category's OWN rows wholesale (inherited/global entries are
 *   untouched - they live on other categories). Queues the subtree facet
 *   recompute.                                                                       (categories.manage)
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const data = await getCategoryAttributesTab(params.id);
    if (!data) throw notFound("Category");
    return apiOk(data);
  },
  { permission: "categories.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const { rows } = await parseJsonBody(req, replaceCategoryAttributesSchema);
    const result = await db.$transaction((tx) =>
      replaceOwnCategoryAttributes(tx, params.id, rows, actor, { ip, userAgent: req.headers.get("user-agent") }),
    );
    await invalidatePublic(["catalog"]);
    const data = await getCategoryAttributesTab(params.id);
    return apiOk({ ...result, effective: data?.effective ?? [] });
  },
  { permission: "categories.manage" },
);
