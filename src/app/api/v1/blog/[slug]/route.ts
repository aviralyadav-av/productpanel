import { notFound } from "@/lib/api/errors";
import { handleOptions, privateJson, publicCachedJson, withPublicApi } from "@/lib/api/public";
import { getBlogPostCached } from "@/features/storefront/cached";
import { findBlogPostIdBySlug, getBlogPost } from "@/features/storefront/queries/blog";
import { assertPreviewAllowed, previewTokenOf } from "@/features/storefront/respond";

/**
 * GET /api/v1/blog/:slug - a published post with sanitised content, related
 * products (as product cards) and related categories. `?preview=<token>`
 * for the `blog` entity shows a draft, uncached (blueprint §14.E6).
 */
export const GET = withPublicApi<{ slug: string }>(
  async ({ req, params, searchParams }) => {
    const token = previewTokenOf(searchParams);
    if (token) {
      assertPreviewAllowed(token, "blog", await findBlogPostIdBySlug(params.slug), "Post");
      const draft = await getBlogPost(params.slug, { preview: true });
      if (!draft) throw notFound("Post");
      return privateJson(draft, { req });
    }
    const post = await getBlogPostCached(params.slug);
    if (!post) throw notFound("Post");
    return publicCachedJson(post);
  },
  { cached: true },
);

export const OPTIONS = handleOptions;
