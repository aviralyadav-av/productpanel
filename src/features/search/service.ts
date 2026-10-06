import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions";
import {
  SEARCH_SCOPES,
  SEARCH_SCOPE_PERMISSIONS,
  searchInputSchema,
  type SearchHit,
  type SearchInput,
  type SearchResult,
  type SearchScope,
} from "./scopes";

/**
 * Global admin search (blueprint §5.2 `GET /api/admin/search`, §14.D14).
 *
 * One query per scope, run in parallel, each bounded by `limit`. Scopes are
 * intersected with the actor's `<module>.view` permissions BEFORE anything is
 * queried, so a customer-support agent searching "gupta" never learns that a
 * seller by that name exists.
 *
 * The response shape is a contract with `EntityPicker`
 * (src/components/shared/entity-picker.tsx) and the ⌘K menu:
 *   { results: [{ scope, id, title, subtitle?, imageUrl?, href }] }
 *
 * `contains` + `mode: "insensitive"` is a plain ILIKE '%q%'. For the sizes an
 * admin panel searches (thousands of rows, eight results) that is the right
 * tool; a full-text index would be premature.
 *
 * No Next imports: this is service code and must stay importable from tests.
 */

export {
  SEARCH_SCOPES,
  SEARCH_SCOPE_LABELS,
  SEARCH_SCOPE_PERMISSIONS,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  SEARCH_MAX_QUERY,
  SEARCH_MIN_QUERY,
  groupHits,
  parseScopesParam,
  searchInputSchema,
  searchScopeSchema,
} from "./scopes";
export type { SearchHit, SearchInput, SearchResult, SearchScope } from "./scopes";

/** The slice of the Actor search needs; type-only so no Next import. */
export type SearchActor = Pick<Actor, "permissions" | "isSuperAdmin">;

/** Scopes the actor may search, optionally narrowed to a requested list. */
export function allowedScopes(actor: SearchActor, requested?: readonly SearchScope[]): SearchScope[] {
  const wanted = requested ?? SEARCH_SCOPES;
  return wanted.filter(
    (scope) => actor.isSuperAdmin || hasPermission(actor.permissions, SEARCH_SCOPE_PERMISSIONS[scope]),
  );
}

const ci = (q: string): Prisma.StringFilter => ({ contains: q, mode: "insensitive" });

type ScopeSearcher = (q: string, limit: number) => Promise<SearchHit[]>;

const SEARCHERS: Record<SearchScope, ScopeSearcher> = {
  async product(q, limit) {
    const rows = await db.product.findMany({
      where: {
        deletedAt: null,
        OR: [
          { title: ci(q) },
          { slug: ci(q) },
          { baseSku: ci(q) },
          { variants: { some: { sku: ci(q) } } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        title: true,
        baseSku: true,
        status: true,
        images: {
          orderBy: { position: "asc" },
          take: 1,
          select: { media: { select: { thumbnailUrl: true, url: true } } },
        },
      },
    });
    return rows.map((row) => ({
      scope: "product" as const,
      id: row.id,
      title: row.title,
      subtitle: [row.baseSku, row.status.toLowerCase()].filter(Boolean).join(" · "),
      imageUrl: row.images[0]?.media.thumbnailUrl ?? row.images[0]?.media.url ?? null,
      href: `/admin/products/${row.id}`,
    }));
  },

  async order(q, limit) {
    const rows = await db.order.findMany({
      where: {
        OR: [
          { orderNumber: ci(q) },
          { guestEmail: ci(q) },
          { customer: { email: ci(q) } },
          { customer: { fullName: ci(q) } },
        ],
      },
      orderBy: { placedAt: "desc" },
      take: limit,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalPaise: true,
        guestEmail: true,
        customer: { select: { fullName: true, email: true } },
      },
    });
    return rows.map((row) => ({
      scope: "order" as const,
      id: row.id,
      title: row.orderNumber,
      subtitle: [
        row.customer?.fullName ?? row.customer?.email ?? row.guestEmail ?? "guest",
        row.status.toLowerCase().replace(/_/g, " "),
        formatRupees(row.totalPaise),
      ].join(" · "),
      href: `/admin/orders/${row.id}`,
    }));
  },

  async customer(q, limit) {
    const rows = await db.customer.findMany({
      where: {
        deletedAt: null,
        OR: [{ fullName: ci(q) }, { email: ci(q) }, { phone: ci(q) }],
      },
      orderBy: { lastOrderAt: { sort: "desc", nulls: "last" } },
      take: limit,
      select: { id: true, fullName: true, email: true, phone: true, orderCount: true },
    });
    return rows.map((row) => ({
      scope: "customer" as const,
      id: row.id,
      title: row.fullName ?? row.email,
      subtitle: [row.email, row.phone, `${row.orderCount} order${row.orderCount === 1 ? "" : "s"}`]
        .filter(Boolean)
        .join(" · "),
      href: `/admin/customers/${row.id}`,
    }));
  },

  async seller(q, limit) {
    const rows = await db.seller.findMany({
      where: {
        deletedAt: null,
        OR: [{ displayName: ci(q) }, { email: ci(q) }, { slug: ci(q) }],
      },
      orderBy: { displayName: "asc" },
      take: limit,
      select: {
        id: true,
        displayName: true,
        email: true,
        status: true,
        logo: { select: { thumbnailUrl: true, url: true } },
      },
    });
    return rows.map((row) => ({
      scope: "seller" as const,
      id: row.id,
      title: row.displayName,
      subtitle: `${row.email} · ${row.status.toLowerCase().replace(/_/g, " ")}`,
      imageUrl: row.logo?.thumbnailUrl ?? row.logo?.url ?? null,
      href: `/admin/sellers/${row.id}`,
    }));
  },

  async category(q, limit) {
    const rows = await db.category.findMany({
      where: { OR: [{ name: ci(q) }, { path: ci(q) }] },
      orderBy: [{ depth: "asc" }, { name: "asc" }],
      take: limit,
      select: {
        id: true,
        name: true,
        path: true,
        isActive: true,
        image: { select: { thumbnailUrl: true, url: true } },
      },
    });
    return rows.map((row) => ({
      scope: "category" as const,
      id: row.id,
      title: row.name,
      subtitle: row.isActive ? row.path : `${row.path} · inactive`,
      imageUrl: row.image?.thumbnailUrl ?? row.image?.url ?? null,
      href: `/admin/categories/${row.id}`,
    }));
  },

  async coupon(q, limit) {
    const rows = await db.coupon.findMany({
      where: { OR: [{ code: ci(q) }, { name: ci(q) }] },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, code: true, name: true, type: true, isActive: true },
    });
    return rows.map((row) => ({
      scope: "coupon" as const,
      id: row.id,
      title: row.code,
      subtitle: [row.name, row.type.toLowerCase().replace(/_/g, " "), row.isActive ? null : "inactive"]
        .filter(Boolean)
        .join(" · "),
      href: `/admin/coupons/${row.id}`,
    }));
  },

  async page(q, limit) {
    const rows = await db.cmsPage.findMany({
      where: { OR: [{ title: ci(q) }, { slug: ci(q) }] },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { id: true, title: true, slug: true, status: true },
    });
    return rows.map((row) => ({
      scope: "page" as const,
      id: row.id,
      title: row.title,
      subtitle: `/${row.slug} · ${row.status.toLowerCase()}`,
      href: `/admin/pages/${row.id}`,
    }));
  },

  async blog(q, limit) {
    const rows = await db.blogPost.findMany({
      where: { OR: [{ title: ci(q) }, { slug: ci(q) }] },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { id: true, title: true, slug: true, status: true },
    });
    return rows.map((row) => ({
      scope: "blog" as const,
      id: row.id,
      title: row.title,
      subtitle: `/${row.slug} · ${row.status.toLowerCase()}`,
      href: `/admin/blog/${row.id}`,
    }));
  },
};

/** Compact rupee display for a subtitle; the full formatter lives in lib/money. */
function formatRupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/**
 * Search every scope the actor may see (or the requested subset of them).
 * Results are grouped by scope in SEARCH_SCOPES order so the UI can render
 * headings without sorting.
 */
export async function searchAdmin(
  actor: SearchActor,
  input: SearchInput,
): Promise<SearchResult> {
  const parsed = searchInputSchema.parse(input);
  const scopes = allowedScopes(actor, parsed.scopes);
  if (scopes.length === 0) return { results: [] };

  const perScope = await Promise.all(
    scopes.map((scope) =>
      SEARCHERS[scope](parsed.q, parsed.limit).catch((error: unknown) => {
        console.error("SEARCH SCOPE FAILED", scope, error);
        return [] as SearchHit[];
      }),
    ),
  );

  return { results: perScope.flat() };
}
