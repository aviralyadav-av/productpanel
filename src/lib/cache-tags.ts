/**
 * Public-cache tags (blueprint D7).
 *
 * Every anonymous `/api/v1` GET is cached with `unstable_cache` / `"use cache"`
 * under one of these tags, and every service that changes what those endpoints
 * return calls `invalidatePublic()` after its transaction commits. Keeping the
 * vocabulary here - not as string literals scattered across services - means a
 * typo cannot silently leave the storefront serving stale data.
 *
 * This module is imported by plain `tsx` processes (the seed, the job worker)
 * as well as by Next. `next/cache` throws outside a Next request scope, so the
 * revalidation call is a guarded dynamic import: in a script it is a no-op and
 * the Next server picks up the change on the next cache miss.
 */

export const CACHE_TAGS = {
  catalog: "catalog",
  content: "content",
  nav: "nav",
  settings: "settings",
  blog: "blog",
  pages: "pages",
} as const;

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

export const ALL_CACHE_TAGS: readonly CacheTag[] = Object.values(CACHE_TAGS);

/**
 * Which tags an entity type touches. A product edit changes listings and
 * facets (catalog) but also any homepage section that resolves products
 * (content); a category edit also changes the navigation menus that point at
 * it. Over-invalidating a little is far cheaper than a stale storefront.
 */
const ENTITY_TAGS: Record<string, readonly CacheTag[]> = {
  product: ["catalog", "content"],
  variant: ["catalog", "content"],
  inventory: ["catalog", "content"],
  category: ["catalog", "content", "nav"],
  attribute: ["catalog"],
  attributeValue: ["catalog"],
  promotion: ["catalog", "content"],
  coupon: ["catalog"],
  seller: ["catalog", "content"],
  review: ["catalog", "content"],
  banner: ["content"],
  section: ["content"],
  block: ["content"],
  footer: ["content", "nav"],
  navigation: ["nav"],
  menu: ["nav"],
  setting: ["settings", "content", "nav"],
  page: ["pages", "nav", "content"],
  faq: ["pages", "content"],
  blogPost: ["blog", "content"],
  blogCategory: ["blog"],
  media: ["catalog", "content", "pages", "blog"],
};

/** Tags to invalidate after a change to `entity` (case-insensitive key). Unknown → every tag. */
export function listTagsFor(entity: string): CacheTag[] {
  const key = entity.charAt(0).toLowerCase() + entity.slice(1);
  const tags = ENTITY_TAGS[key] ?? ENTITY_TAGS[entity];
  return tags ? [...tags] : [...ALL_CACHE_TAGS];
}

/** True only inside the Next.js server runtime, where `next/cache` is usable. */
function insideNext(): boolean {
  return typeof process !== "undefined" && Boolean(process.env.NEXT_RUNTIME);
}

/**
 * Revalidate the public cache for the given tags. Safe to call anywhere:
 * outside Next it does nothing, and inside Next any failure is logged rather
 * than thrown - a cache miss is recoverable, a rolled-back order is not.
 */
export async function invalidatePublic(tags: readonly string[]): Promise<void> {
  const unique = [...new Set(tags)].filter(Boolean);
  if (unique.length === 0 || !insideNext()) return;

  try {
    const { revalidateTag } = await import("next/cache");
    for (const tag of unique) {
      // "max": serve stale while the storefront refetches (Next 16 profile).
      revalidateTag(tag, "max");
    }
  } catch (error) {
    console.warn("invalidatePublic skipped", unique.join(","), error);
  }
}
