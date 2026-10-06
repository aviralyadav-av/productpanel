import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { toIso, type PublicSitemapUrl } from "@/lib/serializers/public";
import { STOREFRONT_PATHS } from "../links";
import { ACTIVE_SELLER_WHERE, ELIGIBLE_PRODUCT_WHERE, publishedBlogWhere } from "./shared";

/**
 * `/api/v1/seo/sitemap`: every public storefront PATH with a lastmod, for the
 * website to wrap in its own <urlset> under its own origin. Rows flagged
 * noIndex are left out on purpose - a sitemap entry for a page that then
 * says "noindex" is a mixed signal search engines penalise.
 */

type Db = Prisma.TransactionClient;

export type PublicSitemap = { generatedAt: string; urls: PublicSitemapUrl[] };

export async function getSitemap(tx?: Db): Promise<PublicSitemap> {
  const client = tx ?? db;
  const now = new Date();

  const [categories, products, pages, posts, sellers] = await Promise.all([
    client.category.findMany({
      where: { isActive: true, noIndex: false },
      select: { path: true, updatedAt: true },
      orderBy: [{ depth: "asc" }, { position: "asc" }],
    }),
    client.product.findMany({
      where: ELIGIBLE_PRODUCT_WHERE,
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
    client.cmsPage.findMany({
      where: { status: "PUBLISHED", noIndex: false },
      select: { slug: true, updatedAt: true },
      orderBy: { slug: "asc" },
    }),
    client.blogPost.findMany({
      where: publishedBlogWhere(now),
      select: { slug: true, updatedAt: true, publishedAt: true },
      orderBy: { publishedAt: "desc" },
    }),
    client.seller.findMany({
      where: { ...ACTIVE_SELLER_WHERE, publishedProductCount: { gt: 0 } },
      select: { slug: true, updatedAt: true },
      orderBy: { slug: "asc" },
    }),
  ]);

  const urls: PublicSitemapUrl[] = [
    { loc: STOREFRONT_PATHS.home(), lastmod: toIso(now), changefreq: "daily", priority: 1 },
    ...categories.map((row) => ({
      loc: STOREFRONT_PATHS.category(row.path),
      lastmod: toIso(row.updatedAt),
      changefreq: "weekly" as const,
      priority: 0.7,
    })),
    ...products.map((row) => ({
      loc: STOREFRONT_PATHS.product(row.slug),
      lastmod: toIso(row.updatedAt),
      changefreq: "daily" as const,
      priority: 0.8,
    })),
    ...pages.map((row) => ({
      loc: STOREFRONT_PATHS.page(row.slug),
      lastmod: toIso(row.updatedAt),
      changefreq: "monthly" as const,
      priority: 0.4,
    })),
    ...(posts.length > 0
      ? [{ loc: STOREFRONT_PATHS.blogIndex(), lastmod: toIso(posts[0].updatedAt), changefreq: "weekly" as const, priority: 0.5 }]
      : []),
    ...posts.map((row) => ({
      loc: STOREFRONT_PATHS.blog(row.slug),
      lastmod: toIso(row.updatedAt ?? row.publishedAt),
      changefreq: "monthly" as const,
      priority: 0.5,
    })),
    ...sellers.map((row) => ({
      loc: STOREFRONT_PATHS.seller(row.slug),
      lastmod: toIso(row.updatedAt),
      changefreq: "weekly" as const,
      priority: 0.5,
    })),
  ];

  return { generatedAt: now.toISOString(), urls };
}
