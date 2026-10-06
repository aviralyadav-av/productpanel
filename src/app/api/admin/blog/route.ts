import { apiCreated, apiList, parseJsonBody, parseListQuery, withAdminApi } from "@/lib/api/admin";
import { can } from "@/lib/auth/guards";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { listBlogPosts } from "@/features/blog/queries";
import { BLOG_SORTS, blogPostFormSchema, parseBlogListFilters, resolveBlogSort } from "@/features/blog/schemas";
import { createBlogPost } from "@/features/blog/service";

/**
 * GET  /api/admin/blog?status&categoryId|none&tag&featured=1|0&authorId&q&sort&order&page&pageSize (blog.view) -> { data: BlogPostListRow[], meta }
 * POST /api/admin/blog  body = BlogPostFormInput (blog.manage; non-draft status needs blog.publish) -> 201 { data: BlogPost }
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, { defaultSort: "updatedAt", allowedSorts: BLOG_SORTS });
    const result = await listBlogPosts({ ...query, sort: resolveBlogSort(query.sort) }, parseBlogListFilters(searchParams));
    return apiList(result.rows, result.meta);
  },
  { permission: "blog.view" },
);

export const POST = withAdminApi(
  async ({ req, actor }) => {
    const input = await parseJsonBody(req, blogPostFormSchema);
    const row = await createBlogPost(input, { actor, canPublish: can(actor, "blog.publish") });
    await invalidatePublic(listTagsFor("blogPost"));
    return apiCreated(row);
  },
  { permission: "blog.manage" },
);
