import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { blogCategoryReorderSchema } from "@/features/blog/schemas";
import { reorderBlogCategories } from "@/features/blog/service";

/** PUT /api/admin/blog/categories/reorder { ids } -> { data: { moved } } (blog.manage) */
export const PUT = withAdminApi(
  async ({ req, actor }) => {
    const input = await parseJsonBody(req, blogCategoryReorderSchema);
    const result = await reorderBlogCategories(input.ids, actor);
    await invalidatePublic(listTagsFor("blogCategory"));
    return apiOk(result);
  },
  { permission: "blog.manage" },
);
