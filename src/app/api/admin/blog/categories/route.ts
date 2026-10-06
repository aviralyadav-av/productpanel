import { apiCreated, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { listBlogCategories } from "@/features/blog/queries";
import { blogCategoryFormSchema } from "@/features/blog/schemas";
import { createBlogCategory } from "@/features/blog/service";

/**
 * GET  /api/admin/blog/categories -> { data: BlogCategoryRow[] } in position order (blog.view)
 * POST /api/admin/blog/categories { name, slug?, description?, isActive } -> 201 { data: BlogCategory } (blog.manage)
 */
export const GET = withAdminApi(async () => apiOk(await listBlogCategories()), { permission: "blog.view" });

export const POST = withAdminApi(
  async ({ req, actor }) => {
    const input = await parseJsonBody(req, blogCategoryFormSchema);
    const row = await createBlogCategory(input, actor);
    await invalidatePublic(listTagsFor("blogCategory"));
    return apiCreated(row);
  },
  { permission: "blog.manage" },
);
