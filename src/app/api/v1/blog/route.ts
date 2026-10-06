import { handleOptions, withPublicApi } from "@/lib/api/public";
import { listBlogPostsCached } from "@/features/storefront/cached";
import { parseBlogListQuery } from "@/features/storefront/queries/blog";
import { publicCachedPage } from "@/features/storefront/respond";

/**
 * GET /api/v1/blog?category=&tag=&q=&featured=&page=&pageSize= - published
 * posts, newest first; `meta.categories` lists the active blog categories
 * with published counts for the sidebar.
 */
export const GET = withPublicApi(
  async ({ searchParams }) => {
    const result = await listBlogPostsCached(parseBlogListQuery(searchParams));
    return publicCachedPage(result.data, result.meta);
  },
  { cached: true },
);

export const OPTIONS = handleOptions;
