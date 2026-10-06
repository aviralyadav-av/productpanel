import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { CMS_PAGE_STATUSES, type CmsPageStatus, type CmsPageTemplate } from "@/lib/enums";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";
import { toPickedAsset } from "@/features/media/dto";
import { getMediaAssets } from "@/features/media/queries";

import type { AuthorOption, ContentAuditRow, PageEditorData, PageListFilters, PageListRow, PageSort } from "./schemas";
import { countWords } from "./text";

/**
 * Read side of CMS pages. List state comes from the URL (§8); the editor
 * payload hydrates the OG image into a PickedAsset so the form paints the
 * thumbnail without a second fetch (media is referenced by ID, never URL).
 */

const LIST_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  content: true,
  template: true,
  status: true,
  publishedAt: true,
  isSystem: true,
  showInFooter: true,
  noIndex: true,
  updatedAt: true,
  createdAt: true,
  author: { select: { name: true, email: true } },
} satisfies Prisma.CmsPageSelect;

export function buildPageWhere(filters: PageListFilters): Prisma.CmsPageWhereInput {
  const clauses: Prisma.CmsPageWhereInput[] = [];
  if (filters.status) clauses.push({ status: filters.status });
  if (filters.template) clauses.push({ template: filters.template });
  if (filters.system !== undefined) clauses.push({ isSystem: filters.system });
  if (filters.footer !== undefined) clauses.push({ showInFooter: filters.footer });
  if (filters.authorId) clauses.push({ authorId: filters.authorId });
  if (filters.q) {
    clauses.push({
      OR: [
        { title: { contains: filters.q, mode: "insensitive" } },
        { slug: { contains: filters.q, mode: "insensitive" } },
        { excerpt: { contains: filters.q, mode: "insensitive" } },
      ],
    });
  }
  return clauses.length > 0 ? { AND: clauses } : {};
}

function orderBy(sort: PageSort, order: "asc" | "desc"): Prisma.CmsPageOrderByWithRelationInput[] {
  switch (sort) {
    case "publishedAt":
      return [{ publishedAt: { sort: order, nulls: "last" } }, { updatedAt: "desc" }];
    case "title":
    case "template":
    case "status":
    case "createdAt":
      return [{ [sort]: order }, { updatedAt: "desc" }];
    default:
      return [{ updatedAt: order }];
  }
}

export type PageListResult = {
  rows: PageListRow[];
  meta: PageMeta;
  statusCounts: Record<CmsPageStatus, number>;
  total: number;
};

export async function listPages(params: ListParams & { sort: PageSort }, filters: PageListFilters): Promise<PageListResult> {
  const where = buildPageWhere(filters);
  // Status tabs count against every OTHER filter so the numbers match what a click would show.
  const { status: _status, ...rest } = filters;
  void _status;
  const tabBase = buildPageWhere(rest);

  const [rows, total, ...counts] = await Promise.all([
    db.cmsPage.findMany({ where, orderBy: orderBy(params.sort, params.order), skip: params.skip, take: params.pageSize, select: LIST_SELECT }),
    db.cmsPage.count({ where }),
    ...CMS_PAGE_STATUSES.map((status) => db.cmsPage.count({ where: { AND: [tabBase, { status }] } })),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      template: row.template as CmsPageTemplate,
      status: row.status as CmsPageStatus,
      publishedAt: row.publishedAt,
      isSystem: row.isSystem,
      showInFooter: row.showInFooter,
      noIndex: row.noIndex,
      authorName: row.author?.name ?? row.author?.email ?? null,
      wordCount: countWords(row.content),
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
    })),
    meta: buildPageMeta(total, params),
    statusCounts: Object.fromEntries(CMS_PAGE_STATUSES.map((status, index) => [status, counts[index]])) as Record<CmsPageStatus, number>,
    total,
  };
}

export async function getPageEditor(id: string): Promise<PageEditorData | null> {
  const row = await db.cmsPage.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, name: true, email: true } },
      _count: { select: { navigationItems: true, banners: true } },
    },
  });
  if (!row) return null;

  const assets = row.ogImageMediaId ? await getMediaAssets([row.ogImageMediaId]) : [];
  const ogAsset = assets[0];

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    content: row.content,
    template: row.template as CmsPageTemplate,
    status: row.status as CmsPageStatus,
    publishedAt: row.publishedAt,
    isSystem: row.isSystem,
    showInFooter: row.showInFooter,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    metaKeywords: row.metaKeywords,
    canonicalUrl: row.canonicalUrl,
    ogImage: ogAsset ? toPickedAsset(ogAsset) : null,
    noIndex: row.noIndex,
    author: row.author,
    usage: { navigationItems: row._count.navigationItems, banners: row._count.banners },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Audit rows for one content entity (D13). Shared by pages and blog because
 * the Activity tab renders the same shape for both; `entityType` is the
 * value the services write ("CmsPage", "BlogPost", "BlogCategory", "Faq").
 */
export async function listContentActivity(entityType: string, entityId: string, limit = 50): Promise<ContentAuditRow[]> {
  const rows = await db.auditLog.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, action: true, summary: true, actorEmail: true, diff: true, createdAt: true, actor: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    summary: row.summary,
    actorEmail: row.actorEmail,
    actorName: row.actor?.name ?? null,
    diff: row.diff,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Active admin users, for the author selects. The SYSTEM_ACTOR row is inactive and so excluded. */
export async function listAuthorOptions(): Promise<AuthorOption[]> {
  return db.user.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    select: { id: true, name: true, email: true },
  });
}

/** Authors that have at least one page, for the list filter. */
export async function listPageAuthors(): Promise<AuthorOption[]> {
  const rows = await db.cmsPage.findMany({
    where: { authorId: { not: null } },
    distinct: ["authorId"],
    select: { author: { select: { id: true, name: true, email: true } } },
  });
  return rows.flatMap((row) => (row.author ? [row.author] : [])).sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
}

export const PAGE_EXPORT_COLUMNS = [
  { key: "title", label: "Title" },
  { key: "slug", label: "Slug" },
  { key: "template", label: "Template" },
  { key: "status", label: "Status" },
  { key: "isSystem", label: "System", type: "boolean" },
  { key: "showInFooter", label: "In footer", type: "boolean" },
  { key: "noIndex", label: "No index", type: "boolean" },
  { key: "authorName", label: "Author" },
  { key: "wordCount", label: "Words", type: "number" },
  { key: "publishedAt", label: "Published", type: "date" },
  { key: "updatedAt", label: "Updated", type: "date" },
] as const;

export async function pageExportRows(filters: PageListFilters): Promise<Array<Record<string, unknown>>> {
  const rows = await db.cmsPage.findMany({ where: buildPageWhere(filters), orderBy: [{ title: "asc" }], select: LIST_SELECT, take: 5000 });
  return rows.map((row) => ({
    title: row.title,
    slug: row.slug,
    template: row.template,
    status: row.status,
    isSystem: row.isSystem,
    showInFooter: row.showInFooter,
    noIndex: row.noIndex,
    authorName: row.author?.name ?? row.author?.email ?? "",
    wordCount: countWords(row.content),
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
  }));
}
