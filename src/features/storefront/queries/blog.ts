import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import {
  BLOG_CARD_SELECT,
  BLOG_DETAIL_SELECT,
  CATEGORY_NODE_SELECT,
  serializeBlogCard,
  serializeBlogPost,
  type PublicBlogCard,
  type PublicBlogCategory,
  type PublicBlogPost,
} from "@/lib/serializers/public";
import { getProductCards } from "./products";
import { pageMeta, parsePageInput, publishedBlogWhere, skipFor, textParam, type PageMeta } from "./shared";

/**
 * Blog reads for `/api/v1/blog` and `/api/v1/blog/:slug` (blueprint §5.3, E6).
 * Live = publishedBlogWhere(): a PUBLISHED post whose publishedAt has passed
 * (or is empty), or a SCHEDULED post whose publishedAt has passed - nothing
 * rewrites a scheduled row, so it goes live here as the cache revalidates.
 */

type Db = Prisma.TransactionClient;

export const BLOG_PAGE_SIZE_DEFAULT = 12;
export const BLOG_PAGE_SIZE_MAX = 48;

export type BlogListQuery = {
  category: string | null;
  tag: string | null;
  q: string | null;
  featured: boolean;
  page: number;
  pageSize: number;
};

export function parseBlogListQuery(searchParams: URLSearchParams): BlogListQuery {
  const { page, pageSize } = parsePageInput(searchParams, {
    defaultSize: BLOG_PAGE_SIZE_DEFAULT,
    maxSize: BLOG_PAGE_SIZE_MAX,
  });
  return {
    category: textParam(searchParams, "category"),
    tag: textParam(searchParams, "tag", 60),
    q: textParam(searchParams, "q", 100),
    featured: searchParams.get("featured") === "true" || searchParams.get("featured") === "1",
    page,
    pageSize,
  };
}

export type BlogListResult = {
  data: PublicBlogCard[];
  meta: PageMeta & { categories: PublicBlogCategory[] };
};

async function blogCategories(client: Db, now: Date): Promise<PublicBlogCategory[]> {
  const [categories, counts] = await Promise.all([
    client.blogCategory.findMany({
      where: { isActive: true },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, slug: true, name: true, description: true },
    }),
    client.blogPost.groupBy({
      by: ["categoryId"],
      where: { ...publishedBlogWhere(now), categoryId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const countById = new Map(counts.map((row) => [row.categoryId, row._count._all]));
  return categories.map((category) => ({
    slug: category.slug,
    name: category.name,
    description: category.description,
    postCount: countById.get(category.id) ?? 0,
  }));
}

/** GET /api/v1/blog */
export async function listBlogPosts(query: BlogListQuery, tx?: Db): Promise<BlogListResult> {
  const client = tx ?? db;
  const now = new Date();
  const clauses: Prisma.BlogPostWhereInput[] = [publishedBlogWhere(now)];
  if (query.category) clauses.push({ category: { slug: query.category, isActive: true } });
  if (query.tag) clauses.push({ tags: { has: query.tag } });
  if (query.featured) clauses.push({ isFeatured: true });
  if (query.q) {
    clauses.push({
      OR: [
        { title: { contains: query.q, mode: "insensitive" } },
        { excerpt: { contains: query.q, mode: "insensitive" } },
      ],
    });
  }
  const where: Prisma.BlogPostWhereInput = { AND: clauses };

  const [total, rows, categories] = await Promise.all([
    client.blogPost.count({ where }),
    client.blogPost.findMany({
      where,
      orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      skip: skipFor(query),
      take: query.pageSize,
      select: BLOG_CARD_SELECT,
    }),
    blogCategories(client, now),
  ]);

  return { data: rows.map(serializeBlogCard), meta: { ...pageMeta(total, query), categories } };
}

export async function findBlogPostIdBySlug(slug: string, tx?: Db): Promise<string | null> {
  const row = await (tx ?? db).blogPost.findUnique({ where: { slug }, select: { id: true } });
  return row?.id ?? null;
}

export const BLOG_RELATED_PRODUCTS_LIMIT = 8;

/** GET /api/v1/blog/:slug */
export async function getBlogPost(
  slug: string,
  options: { preview?: boolean } = {},
  tx?: Db,
): Promise<PublicBlogPost | null> {
  const client = tx ?? db;
  const now = new Date();
  const row = await client.blogPost.findFirst({
    where: options.preview ? { slug } : { AND: [{ slug }, publishedBlogWhere(now)] },
    select: BLOG_DETAIL_SELECT,
  });
  if (!row) return null;

  const [relatedProducts, relatedCategories] = await Promise.all([
    getProductCards({ ids: row.relatedProductIds, take: BLOG_RELATED_PRODUCTS_LIMIT }, client),
    row.relatedCategoryIds.length === 0
      ? Promise.resolve([])
      : client.category.findMany({
          where: { id: { in: row.relatedCategoryIds }, isActive: true },
          select: CATEGORY_NODE_SELECT,
        }),
  ]);
  const orderedCategories = row.relatedCategoryIds
    .map((id) => relatedCategories.find((category) => category.id === id))
    .filter((category): category is (typeof relatedCategories)[number] => Boolean(category));

  return serializeBlogPost(row, { relatedProducts, relatedCategories: orderedCategories });
}
