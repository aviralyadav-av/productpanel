import { apiCreated, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { db } from "@/lib/db";

import { listCategoryTree, nestCategoryTree } from "@/features/categories/queries";
import { categoryInputSchema } from "@/features/categories/schemas";
import { createCategory } from "@/features/categories/service";

/**
 * GET  /api/admin/categories            flat rows with depth, path and rolled-up counts   (categories.view)
 * GET  /api/admin/categories?tree=1     the same rows nested under `children`
 * POST /api/admin/categories            create; slug derived + suffixed when omitted        (categories.manage)
 *
 * The flat form is what pickers (CategoryTreeSelect) consume; the nested one
 * is for clients that want to render a menu without rebuilding the tree.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const rows = await listCategoryTree();
    const asTree = searchParams.get("tree") === "1" || searchParams.get("tree") === "true";
    return apiOk(asTree ? nestCategoryTree(rows) : rows);
  },
  { permission: "categories.view" },
);

export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const input = await parseJsonBody(req, categoryInputSchema);
    const category = await db.$transaction((tx) => createCategory(tx, input, actor, { ip, userAgent: req.headers.get("user-agent") }));
    await invalidatePublic(listTagsFor("category"));
    return apiCreated(category);
  },
  { permission: "categories.manage" },
);
