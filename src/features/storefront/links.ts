/**
 * Storefront URL patterns and link resolution (blueprint §14.E1, §5.3).
 *
 * The customer website is built separately, so the public API never hands it
 * a database id to turn into a route - it hands it the finished path. Every
 * place that produces a storefront URL (banners, sections, navigation, the
 * sitemap, breadcrumbs) goes through this file so the website team has ONE
 * table of patterns to implement, documented in docs/PUBLIC_API.md:
 *
 *   category  /c/<category-path-without-leading-slash>   e.g. /c/fashion/kurta
 *   product   /p/<product-slug>
 *   page      /pages/<cms-page-slug>
 *   blog      /blog/<post-slug>          (index: /blog)
 *   seller    /sellers/<seller-slug>
 *
 * Nothing here touches the database: the callers select the target rows they
 * need (slug/path/status) and pass them in, which keeps the resolution
 * unit-testable and lets a banner query resolve its link with zero extra
 * round trips.
 */

export const STOREFRONT_PATHS = {
  home: (): string => "/",
  /** `Category.path` is "/fashion/kurta"; the storefront route drops the leading slash. */
  category: (path: string): string => `/c/${path.replace(/^\/+/, "")}`,
  product: (slug: string): string => `/p/${encodeURIComponent(slug)}`,
  page: (slug: string): string => `/pages/${encodeURIComponent(slug)}`,
  blog: (slug: string): string => `/blog/${encodeURIComponent(slug)}`,
  blogIndex: (): string => "/blog",
  seller: (slug: string): string => `/sellers/${encodeURIComponent(slug)}`,
} as const;

/** What the website receives for any linkable thing. `url` is null when the target is gone. */
export type PublicLink = { type: string; url: string | null };

export const NO_LINK: PublicLink = { type: "NONE", url: null };

// ---------------------------------------------------------------------------
// Target availability - shared by banners, sections and navigation
// ---------------------------------------------------------------------------

export type CategoryTarget = { path: string; isActive: boolean } | null | undefined;
export type ProductTarget =
  | {
      slug: string;
      status: string;
      deletedAt: Date | string | null;
      seller: { status: string; deletedAt: Date | string | null } | null;
    }
  | null
  | undefined;
export type PageTarget = { slug: string; status: string } | null | undefined;
export type BlogTarget = { slug: string; status: string; publishedAt: Date | string | null } | null | undefined;

export function categoryAvailable(target: CategoryTarget): target is NonNullable<CategoryTarget> {
  return Boolean(target && target.isActive);
}

/** Mirrors the product eligibility rule in queries/shared.ts: published, not deleted, seller active or platform-owned. */
export function productAvailable(target: ProductTarget): target is NonNullable<ProductTarget> {
  if (!target || target.status !== "PUBLISHED" || target.deletedAt) return false;
  if (target.seller && (target.seller.status !== "ACTIVE" || target.seller.deletedAt)) return false;
  return true;
}

export function pageAvailable(target: PageTarget): target is NonNullable<PageTarget> {
  return Boolean(target && target.status === "PUBLISHED");
}

/**
 * SCHEDULED counts as live once its time has passed: no job rewrites the row
 * (there is no `blog.publish_scheduled` job type), so the read side is what
 * publishes it - same rule as publishedBlogWhere() in queries/shared.ts. A
 * SCHEDULED post with no date has no time to have passed, so it stays hidden.
 */
export function blogAvailable(target: BlogTarget, now: Date = new Date()): target is NonNullable<BlogTarget> {
  if (!target) return false;
  if (target.status !== "PUBLISHED" && target.status !== "SCHEDULED") return false;
  if (target.status === "SCHEDULED" && !target.publishedAt) return false;
  if (target.publishedAt && new Date(target.publishedAt) > now) return false;
  return true;
}

/**
 * Only http(s) and site-relative URLs may be handed to the storefront as a
 * link; anything else (javascript:, data:, protocol-relative) becomes null.
 */
export function safeLinkUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const value = url.trim();
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("#") || /^mailto:/i.test(value) || /^tel:/i.test(value)) return value;
  return null;
}

/**
 * Resolve a Banner / ContentSection style link. The row carries `linkType`
 * plus whichever target the caller already loaded; missing or unavailable
 * targets resolve to `url: null` rather than to a dead path.
 */
export function resolveLink(input: {
  linkType: string;
  linkUrl?: string | null;
  category?: CategoryTarget;
  product?: ProductTarget;
  page?: PageTarget;
  blog?: BlogTarget;
}): PublicLink {
  switch (input.linkType) {
    case "URL":
      return { type: "URL", url: safeLinkUrl(input.linkUrl) };
    case "CATEGORY":
      return {
        type: "CATEGORY",
        url: categoryAvailable(input.category) ? STOREFRONT_PATHS.category(input.category.path) : null,
      };
    case "PRODUCT":
      return {
        type: "PRODUCT",
        url: productAvailable(input.product) ? STOREFRONT_PATHS.product(input.product.slug) : null,
      };
    case "PAGE":
      return { type: "PAGE", url: pageAvailable(input.page) ? STOREFRONT_PATHS.page(input.page.slug) : null };
    case "BLOG":
      // Banners have no blog FK: a BLOG banner carries the post slug (or a
      // full URL) in linkUrl. Sections resolve linkTargetId to a post first.
      if (blogAvailable(input.blog)) return { type: "BLOG", url: STOREFRONT_PATHS.blog(input.blog.slug) };
      if (input.linkUrl) {
        const raw = input.linkUrl.trim();
        const url = raw.startsWith("/") || /^https?:/i.test(raw) ? safeLinkUrl(raw) : STOREFRONT_PATHS.blog(raw);
        return { type: "BLOG", url };
      }
      return { type: "BLOG", url: null };
    default:
      return NO_LINK;
  }
}

/** Navigation items add HOME and always keep a URL fallback so a menu never renders a dead label. */
export function resolveNavigationLink(item: {
  type: string;
  url: string | null;
  category?: CategoryTarget;
  product?: ProductTarget;
  page?: PageTarget;
}): { url: string | null; isAvailable: boolean } {
  switch (item.type) {
    case "HOME":
      return { url: STOREFRONT_PATHS.home(), isAvailable: true };
    case "URL":
      return { url: safeLinkUrl(item.url), isAvailable: Boolean(safeLinkUrl(item.url)) };
    case "CATEGORY":
      return categoryAvailable(item.category)
        ? { url: STOREFRONT_PATHS.category(item.category.path), isAvailable: true }
        : { url: safeLinkUrl(item.url), isAvailable: false };
    case "PRODUCT":
      return productAvailable(item.product)
        ? { url: STOREFRONT_PATHS.product(item.product.slug), isAvailable: true }
        : { url: safeLinkUrl(item.url), isAvailable: false };
    case "PAGE":
      return pageAvailable(item.page)
        ? { url: STOREFRONT_PATHS.page(item.page.slug), isAvailable: true }
        : { url: safeLinkUrl(item.url), isAvailable: false };
    case "BLOG":
      return { url: safeLinkUrl(item.url) ?? STOREFRONT_PATHS.blogIndex(), isAvailable: true };
    default:
      return { url: safeLinkUrl(item.url), isAvailable: Boolean(safeLinkUrl(item.url)) };
  }
}
