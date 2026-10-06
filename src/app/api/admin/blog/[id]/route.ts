import { notFound } from "@/lib/api/errors";
import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { can } from "@/lib/auth/guards";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { getBlogPostEditor } from "@/features/blog/queries";
import { blogPostFormSchema } from "@/features/blog/schemas";
import { deleteBlogPost, updateBlogPost } from "@/features/blog/service";

/**
 * GET    /api/admin/blog/:id -> { data: BlogPostEditorData }         (blog.view)
 * PUT    /api/admin/blog/:id  body = BlogPostFormInput -> { data }    (blog.manage; status change needs blog.publish)
 * DELETE /api/admin/blog/:id -> 204                                   (blog.manage)
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const post = await getBlogPostEditor(params.id);
    if (!post) throw notFound("Blog post");
    return apiOk(post);
  },
  { permission: "blog.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, actor, params }) => {
    const input = await parseJsonBody(req, blogPostFormSchema);
    const row = await updateBlogPost(params.id, input, { actor, canPublish: can(actor, "blog.publish") });
    await invalidatePublic(listTagsFor("blogPost"));
    return apiOk(row);
  },
  { permission: "blog.manage" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ actor, params }) => {
    await deleteBlogPost(params.id, { actor, canPublish: can(actor, "blog.publish") });
    await invalidatePublic(listTagsFor("blogPost"));
    return apiNoContent();
  },
  { permission: "blog.manage" },
);
