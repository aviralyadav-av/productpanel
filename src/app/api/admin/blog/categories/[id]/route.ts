import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { blogCategoryFormSchema } from "@/features/blog/schemas";
import { deleteBlogCategory, updateBlogCategory } from "@/features/blog/service";

/**
 * PUT    /api/admin/blog/categories/:id { name, slug?, description?, isActive } -> { data: BlogCategory } (blog.manage)
 * DELETE /api/admin/blog/categories/:id -> { data: { id, name, detachedPosts } }  (blog.manage; posts become uncategorised)
 */
export const PUT = withAdminApi<{ id: string }>(
  async ({ req, actor, params }) => {
    const input = await parseJsonBody(req, blogCategoryFormSchema);
    const row = await updateBlogCategory(params.id, input, actor);
    await invalidatePublic(listTagsFor("blogCategory"));
    return apiOk(row);
  },
  { permission: "blog.manage" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ actor, params }) => {
    const result = await deleteBlogCategory(params.id, actor);
    await invalidatePublic(listTagsFor("blogCategory"));
    return apiOk(result);
  },
  { permission: "blog.manage" },
);
