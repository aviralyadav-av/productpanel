import { unstable_cache } from "next/cache";

import { CACHE_TAGS } from "@/lib/cache-tags";
import { listBlogPosts, getBlogPost, type BlogListQuery } from "./queries/blog";
import { getBanners } from "./queries/banners";
import { getCategoryPage, getCategoryTree } from "./queries/categories";
import { getFaqGroups } from "./queries/faqs";
import { getFooter } from "./queries/footer";
import { getHome } from "./queries/home";
import { getMenu } from "./queries/navigation";
import { getPage } from "./queries/pages";
import { getProductDetail, listProductReviews, listProducts, type ProductListQuery } from "./queries/products";
import { getSellerPage } from "./queries/sellers";
import { getPublicSettingsPayload } from "./queries/settings";
import { getSitemap } from "./queries/sitemap";

/**
 * Server-side cache for the anonymous `/api/v1` reads (blueprint §14.D7).
 *
 * `unstable_cache` keys each entry by the wrapper's key parts PLUS its
 * serialised arguments, which is why every query takes a normalised, plain
 * argument (a sorted query object, a slug) and returns plain JSON (ISO
 * strings, never Date). Entries are tagged with CACHE_TAGS so the services'
 * `invalidatePublic(listTagsFor(entity))` drops exactly the affected reads;
 * `revalidate` is the safety net for scheduled content (sale windows, banner
 * schedules) that changes without any admin write.
 *
 * This module imports `next/cache`, so it is for route files only. The query
 * functions themselves stay Next-free for tests and the denylist check.
 */

/** Seconds before a cached read is refreshed even without an invalidation. */
const REVALIDATE_SECONDS = 60;

const { catalog, content, nav, settings, blog, pages } = CACHE_TAGS;

function cached<A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>, tags: string[]) {
  return unstable_cache(fn, ["api-v1", name], { tags, revalidate: REVALIDATE_SECONDS });
}

export const getCategoryTreeCached = cached("categories", () => getCategoryTree(), [catalog]);
export const getCategoryPageCached = cached("category", (slug: string) => getCategoryPage(slug), [catalog]);

export const listProductsCached = cached("products", (query: ProductListQuery) => listProducts(query), [catalog]);
export const getProductDetailCached = cached("product", (slug: string) => getProductDetail(slug), [catalog]);
export const listProductReviewsCached = cached(
  "product-reviews",
  (slug: string, page: number, pageSize: number) => listProductReviews(slug, { page, pageSize }),
  [catalog],
);

// The homepage reads products, categories, banners, sellers, reviews, blocks
// and the footer, so every tag that can change any of those must drop it.
export const getHomeCached = cached("home", () => getHome(), [content, catalog, nav, settings, pages]);
export const getBannersCached = cached("banners", (placement: string | null) => getBanners({ placement }), [content]);
export const getMenuCached = cached("navigation", (slug: string) => getMenu(slug), [nav, catalog, pages]);

export const getPageCached = cached("page", (slug: string) => getPage(slug), [pages]);
export const getFaqGroupsCached = cached("faqs", () => getFaqGroups(), [pages]);
export const getFooterCached = cached("footer", () => getFooter(), [content, nav, settings, pages]);
export const getPublicSettingsCached = cached("settings", () => getPublicSettingsPayload(), [settings]);

export const listBlogPostsCached = cached("blog", (query: BlogListQuery) => listBlogPosts(query), [blog]);
export const getBlogPostCached = cached("blog-post", (slug: string) => getBlogPost(slug), [blog, catalog]);

export const getSellerPageCached = cached(
  "seller",
  (slug: string, page: number, pageSize: number, sort: Parameters<typeof getSellerPage>[1]["sort"]) =>
    getSellerPage(slug, { page, pageSize, sort }),
  [catalog],
);

export const getSitemapCached = cached("sitemap", () => getSitemap(), [catalog, pages, blog, content]);
