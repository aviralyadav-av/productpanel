import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { BLOG_STATUSES, type BlogStatus } from "@/lib/enums";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";
import type { EntityRef } from "@/components/shared/entity-picker";
import { toPickedAsset } from "@/features/media/dto";
import { getMediaAssets } from "@/features/media/queries";

import { effectiveBlogStatus, type BlogCategoryRow, type BlogListFilters, type BlogPostEditorData, type BlogPostListRow, type BlogSort } from "./schemas";

/**
 * Read side of the blog. The list shows both the stored status and what the
 * storefront currently renders (a SCHEDULED post whose time has passed is
 * live) so an operator is never surprised by "it says scheduled but it's up".
 */

const MEDIA_SELECT = { select: { url: true, thumbnailUrl: true, alt: true } } as const;

export function buildBlogWhere(filters: BlogListFilters): Prisma.BlogPostWhereInput {
  const clauses: Prisma.BlogPostWhereInput[] = [];
  if (filters.status) clauses.push({ status: filters.status });
  if (filters.categoryId) clauses.push(filters.categoryId === "none" ? { categoryId: null } : { categoryId: filters.categoryId });
  if (filters.tag) clauses.push({ tags: { has: filters.tag } });
  if (filters.featured !== undefined) clauses.push({ isFeatured: filters.featured });
  if (filters.authorId) clauses.push({ authorId: filters.authorId });
  if (filters.q) {
    clauses.push({
      OR: [
        { title: { contains: filters.q, mode: "insensitive" } },
        { slug: { contains: filters.q, mode: "insensitive" } },
        { excerpt: { contains: filters.q, mode: "insensitive" } },
        { authorName: { contains: filters.q, mode: "insensitive" } },
        { tags: { has: filters.q.toLowerCase() } },
      ],
    });
  }
  return clauses.length > 0 ? { AND: clauses } : {};
}

function orderBy(sort: BlogSort, order: "asc" | "desc"): Prisma.BlogPostOrderByWithRelationInput[] {
  switch (sort) {
    case "publishedAt":
      return [{ publishedAt: { sort: order, nulls: "last" } }, { updatedAt: "desc" }];
    case "title":
    case "status":
    case "createdAt":
    case "viewCount":
      return [{ [sort]: order }, { updatedAt: "desc" }];
    default:
      return [{ updatedAt: order }];
  }
}

export type BlogListResult = { rows: BlogPostListRow[]; meta: PageMeta; statusCounts: Record<BlogStatus, number>; total: number };

export async function listBlogPosts(params: ListParams & { sort: BlogSort }, filters: BlogListFilters, now: Date = new Date()): Promise<BlogListResult> {
  const where = buildBlogWhere(filters);
  const { status: _status, ...rest } = filters;
  void _status;
  const tabBase = buildBlogWhere(rest);

  const [rows, total, ...counts] = await Promise.all([
    db.blogPost.findMany({
      where,
      orderBy: orderBy(params.sort, params.order),
      skip: params.skip,
      take: params.pageSize,
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        status: true,
        publishedAt: true,
        isFeatured: true,
        tags: true,
        authorName: true,
        readingMinutes: true,
        viewCount: true,
        updatedAt: true,
        createdAt: true,
        category: { select: { id: true, name: true } },
        featuredImage: MEDIA_SELECT,
      },
    }),
    db.blogPost.count({ where }),
    ...BLOG_STATUSES.map((status) => db.blogPost.count({ where: { AND: [tabBase, { status }] } })),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      status: row.status as BlogStatus,
      effectiveStatus: effectiveBlogStatus(row, now),
      publishedAt: row.publishedAt,
      isFeatured: row.isFeatured,
      category: row.category,
      tags: row.tags,
      authorName: row.authorName,
      readingMinutes: row.readingMinutes,
      viewCount: row.viewCount,
      featuredImage: row.featuredImage,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
    })),
    meta: buildPageMeta(total, params),
    statusCounts: Object.fromEntries(BLOG_STATUSES.map((status, index) => [status, counts[index]])) as Record<BlogStatus, number>,
    total,
  };
}

/** Every distinct tag in use with its count - suggestions for TagInput and the tag filter. */
export async function listBlogTags(): Promise<Array<{ tag: string; count: number }>> {
  const rows = await db.blogPost.findMany({ select: { tags: true } });
  const counts = new Map<string, number>();
  for (const row of rows) for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Authors with at least one post, for the list filter. */
export async function listBlogAuthors(): Promise<Array<{ id: string; name: string | null; email: string }>> {
  const rows = await db.blogPost.findMany({ where: { authorId: { not: null } }, distinct: ["authorId"], select: { author: { select: { id: true, name: true, email: true } } } });
  return rows.flatMap((row) => (row.author ? [row.author] : [])).sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
}

export async function getBlogPostEditor(id: string): Promise<BlogPostEditorData | null> {
  const row = await db.blogPost.findUnique({ where: { id } });
  if (!row) return null;

  const [assets, products, categories] = await Promise.all([
    row.featuredImageMediaId ? getMediaAssets([row.featuredImageMediaId]) : Promise.resolve([]),
    row.relatedProductIds.length > 0
      ? db.product.findMany({ where: { id: { in: row.relatedProductIds } }, select: { id: true, title: true, baseSku: true, status: true } })
      : Promise.resolve([]),
    row.relatedCategoryIds.length > 0 ? db.category.findMany({ where: { id: { in: row.relatedCategoryIds } }, select: { id: true, name: true, path: true } }) : Promise.resolve([]),
  ]);

  // Keep the operator's order; drop ids whose rows are gone (deleted product) so the chips match reality.
  const productRefs: EntityRef[] = row.relatedProductIds.flatMap((pid) => {
    const product = products.find((entry) => entry.id === pid);
    return product ? [{ id: product.id, title: product.title, subtitle: product.baseSku ?? product.status }] : [];
  });
  const categoryRefs: EntityRef[] = row.relatedCategoryIds.flatMap((cid) => {
    const category = categories.find((entry) => entry.id === cid);
    return category ? [{ id: category.id, title: category.name, subtitle: category.path }] : [];
  });

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    content: row.content,
    featuredImage: assets[0] ? toPickedAsset(assets[0]) : null,
    categoryId: row.categoryId,
    tags: row.tags,
    authorId: row.authorId,
    authorName: row.authorName,
    status: row.status as BlogStatus,
    publishedAt: row.publishedAt,
    readingMinutes: row.readingMinutes,
    viewCount: row.viewCount,
    isFeatured: row.isFeatured,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    metaKeywords: row.metaKeywords,
    canonicalUrl: row.canonicalUrl,
    relatedProducts: productRefs,
    relatedCategories: categoryRefs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listBlogCategories(): Promise<BlogCategoryRow[]> {
  const rows = await db.blogCategory.findMany({
    orderBy: [{ position: "asc" }, { name: "asc" }],
    include: { _count: { select: { posts: true } } },
  });
  const published = await db.blogPost.groupBy({ by: ["categoryId"], where: { status: { in: ["PUBLISHED", "SCHEDULED"] } }, _count: { _all: true } });
  const publishedBy = new Map(published.map((entry) => [entry.categoryId, entry._count._all]));
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    position: row.position,
    isActive: row.isActive,
    postCount: row._count.posts,
    publishedCount: publishedBy.get(row.id) ?? 0,
    updatedAt: row.updatedAt,
  }));
}

export const BLOG_EXPORT_COLUMNS = [
  { key: "title", label: "Title" },
  { key: "slug", label: "Slug" },
  { key: "status", label: "Status" },
  { key: "category", label: "Category" },
  { key: "tags", label: "Tags" },
  { key: "authorName", label: "Author" },
  { key: "isFeatured", label: "Featured", type: "boolean" },
  { key: "readingMinutes", label: "Reading minutes", type: "number" },
  { key: "viewCount", label: "Views", type: "number" },
  { key: "publishedAt", label: "Published", type: "date" },
  { key: "updatedAt", label: "Updated", type: "date" },
] as const;

export async function blogExportRows(filters: BlogListFilters): Promise<Array<Record<string, unknown>>> {
  const rows = await db.blogPost.findMany({
    where: buildBlogWhere(filters),
    orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
    take: 5000,
    select: { title: true, slug: true, status: true, tags: true, authorName: true, isFeatured: true, readingMinutes: true, viewCount: true, publishedAt: true, updatedAt: true, category: { select: { name: true } } },
  });
  return rows.map((row) => ({ ...row, category: row.category?.name ?? "", tags: row.tags.join(", ") }));
}
