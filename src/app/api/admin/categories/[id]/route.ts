import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { db } from "@/lib/db";

import { getCategoryEditor } from "@/features/categories/queries";
import { categoryPatchSchema, deleteCategorySchema } from "@/features/categories/schemas";
import { deleteCategory, updateCategory } from "@/features/categories/service";

/**
 * GET    /api/admin/categories/:id                    category + media, usage, breadcrumb, commission   (categories.view)
 * PUT    /api/admin/categories/:id  { …partial }      slug/parent changes rewrite the subtree's paths   (categories.manage)
 * DELETE /api/admin/categories/:id?reassignTo=<id>    409 while children/products exist and no target   (categories.manage)
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const editor = await getCategoryEditor(params.id);
    if (!editor) throw notFound("Category");
    return apiOk(editor);
  },
  { permission: "categories.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const patch = await parseJsonBody(req, categoryPatchSchema);
    const result = await db.$transaction((tx) =>
      updateCategory(tx, params.id, patch, actor, { ip, userAgent: req.headers.get("user-agent") }),
    );
    await invalidatePublic(listTagsFor("category"));
    return apiOk(result);
  },
  { permission: "categories.manage" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ req, params, searchParams, actor, ip }) => {
    const input = deleteCategorySchema.parse({ id: params.id, reassignTo: searchParams.get("reassignTo") ?? undefined });
    const result = await db.$transaction((tx) => deleteCategory(tx, input, actor, { ip, userAgent: req.headers.get("user-agent") }));
    await invalidatePublic(listTagsFor("category"));
    return apiOk(result);
  },
  { permission: "categories.manage" },
);
