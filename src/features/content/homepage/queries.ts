import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { BANNER_PLACEMENT_META, type BannerPlacement, type LinkType } from "@/lib/enums";
import { asObject } from "@/lib/json";
import type { EntityRef } from "@/components/shared/entity-picker";
import type { PickedAsset } from "@/components/shared/media-picker";
import { hydrateEntityRefs } from "@/features/coupons/queries";
import { toPickedAsset } from "@/features/media/dto";
import { getMediaAssets } from "@/features/media/queries";
import {
  blockLabel,
  isSectionType,
  scheduleState,
  sectionDefinition,
  type EntityKind,
  type FieldDescriptor,
  type SectionDefinition,
} from "@/features/content/registry";

import { previewSection } from "./preview";
import { HOME_PAGE } from "./service";
import type { FooterEditorData, SectionBoardRow, SectionEditorData, SectionPreviewData } from "./schemas";

/**
 * Read side of /admin/homepage (Server Components + REST GETs).
 *
 * The editor payload hydrates every id the form will show as a chip or a
 * thumbnail (entity fields, media fields, the row-level link target) so the
 * Sheet renders complete on first paint - the alternative, a client fetch per
 * field, would flash empty pickers on every open.
 */

type Db = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

/** Plain-English "where do the items come from" for the board row. */
function sourceNote(definition: SectionDefinition, payload: Record<string, unknown>, blockCount: number): string {
  const source = payload.source === "manual" ? "manual" : "auto";
  const listed = (key: string) => (Array.isArray(payload[key]) ? (payload[key] as unknown[]).length : 0);
  switch (definition.resolver) {
    case "banners": {
      const placement = typeof payload.placement === "string" ? payload.placement : definition.type === "promo_banners" ? "HOME_PROMO" : "HOME_HERO";
      const meta = BANNER_PLACEMENT_META[placement as BannerPlacement];
      return `Banners · ${meta?.label ?? placement}`;
    }
    case "categories":
      return source === "manual" ? `${listed("categoryIds")} picked categories` : "Featured categories";
    case "products": {
      if (source === "manual") return `${listed("productIds")} picked products`;
      const rule: Record<string, string> = {
        new_arrivals: "Newest products",
        best_sellers: "By order count",
        trending: "Trending flag",
        featured_products: "Featured flag",
      };
      return rule[definition.type] ?? "Products";
    }
    case "collection":
      return [
        listed("productIds") ? `${listed("productIds")} products` : null,
        payload.categoryId ? "a category" : null,
        typeof payload.tag === "string" && payload.tag ? `tag "${payload.tag}"` : null,
      ]
        .filter(Boolean)
        .join(" + ") || "Empty collection";
    case "sellers":
      return source === "manual" ? `${listed("sellerIds")} picked sellers` : "Top-rated sellers";
    case "testimonials":
      return source === "manual" ? `${listed("reviewIds")} picked reviews` : "Testimonial reviews";
    case "featuredReviews":
      return `Featured reviews, ${String(payload.minRating ?? 4)}★ and up`;
    case "blocks":
      return `${blockCount} ${definition.blockNoun}${blockCount === 1 ? "" : "s"}`;
    case "footer":
      return "Footer config + menus footer-1..3";
    case "stored":
    default:
      return "Content stored on the section";
  }
}

export async function listHomeSections(now: Date = new Date(), tx?: Db): Promise<SectionBoardRow[]> {
  const client = tx ?? db;
  const rows = await client.contentSection.findMany({
    where: { page: HOME_PAGE },
    orderBy: [{ position: "asc" }, { key: "asc" }],
    include: { _count: { select: { blocks: true } } },
  });
  return rows.map((row) => {
    const definition = sectionDefinition(row.type);
    const payload = asObject<Record<string, unknown>>(row.payload, {});
    return {
      id: row.id,
      key: row.key,
      type: row.type,
      title: row.title,
      subtitle: row.subtitle,
      position: row.position,
      enabled: row.enabled,
      publishAt: row.publishAt,
      unpublishAt: row.unpublishAt,
      linkType: row.linkType,
      buttonText: row.buttonText,
      hasImage: Boolean(row.imageMediaId),
      blockCount: row._count.blocks,
      state: scheduleState(row, now),
      typeLabel: definition.label,
      typeKnown: isSectionType(row.type),
      sourceNote: sourceNote(definition, payload, row._count.blocks),
      updatedAt: row.updatedAt,
    };
  });
}

export async function homepageKpis(now: Date = new Date()): Promise<{ total: number; live: number; scheduled: number; expired: number; disabled: number }> {
  const rows = await listHomeSections(now);
  const kpis = { total: rows.length, live: 0, scheduled: 0, expired: 0, disabled: 0 };
  for (const row of rows) kpis[row.state] += 1;
  return kpis;
}

// ---------------------------------------------------------------------------
// Hydration helpers
// ---------------------------------------------------------------------------

/** Chips for every EntityKind the registry can name; coupons' helper covers the catalog kinds. */
export async function hydrateRefs(kind: EntityKind, ids: readonly string[], client: Db = db): Promise<EntityRef[]> {
  if (ids.length === 0) return [];
  const list = [...ids];
  const order = (refs: EntityRef[]) => {
    const byId = new Map(refs.map((ref) => [ref.id, ref]));
    return list.map((id) => byId.get(id)).filter((ref): ref is EntityRef => Boolean(ref));
  };
  switch (kind) {
    case "category":
    case "product":
    case "seller":
      return hydrateEntityRefs(kind, list, client);
    case "page": {
      const rows = await client.cmsPage.findMany({ where: { id: { in: list } }, select: { id: true, title: true, slug: true, status: true } });
      return order(rows.map((row) => ({ id: row.id, title: row.title, subtitle: `/${row.slug} · ${row.status}` })));
    }
    case "blog": {
      const rows = await client.blogPost.findMany({ where: { id: { in: list } }, select: { id: true, title: true, slug: true, status: true } });
      return order(rows.map((row) => ({ id: row.id, title: row.title, subtitle: `${row.slug} · ${row.status}` })));
    }
    case "review": {
      const rows = await client.review.findMany({
        where: { id: { in: list } },
        select: { id: true, authorName: true, title: true, rating: true, status: true },
      });
      return order(
        rows.map((row) => ({
          id: row.id,
          title: row.title ? `${row.title} — ${row.authorName}` : row.authorName,
          subtitle: `${row.rating ?? "–"}★ · ${row.status}`,
        })),
      );
    }
    case "media": {
      const assets = await getMediaAssets(list);
      return order(assets.map((asset) => ({ id: asset.id, title: asset.filename, imageUrl: asset.thumbnailUrl ?? asset.url })));
    }
    default:
      return [];
  }
}

function idsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function linkKind(linkType: string): EntityKind | null {
  switch (linkType) {
    case "CATEGORY":
      return "category";
    case "PRODUCT":
      return "product";
    case "PAGE":
      return "page";
    case "BLOG":
      return "blog";
    default:
      return null;
  }
}

/** For `entity`/`entity-list` payload fields: which kind to hydrate, honouring a paired link-type field. */
function fieldKind(field: FieldDescriptor, payload: Record<string, unknown>): EntityKind | null {
  if (field.linkTypeField) {
    const linkType = payload[field.linkTypeField];
    return typeof linkType === "string" ? linkKind(linkType) : null;
  }
  return field.entityKind ?? null;
}

async function hydratePayload(
  definition: SectionDefinition,
  payload: Record<string, unknown>,
): Promise<{ refs: Record<string, EntityRef[]>; media: Record<string, PickedAsset | null> }> {
  const refs: Record<string, EntityRef[]> = {};
  const media: Record<string, PickedAsset | null> = {};
  const mediaFields = definition.fields.filter((field) => field.type === "media" || field.type === "image");
  const mediaIds = mediaFields.flatMap((field) => idsOf(payload[field.name]));
  const assets = await getMediaAssets(mediaIds);
  for (const field of mediaFields) {
    const id = idsOf(payload[field.name])[0];
    const asset = id ? assets.find((entry) => entry.id === id) : undefined;
    media[field.name] = asset ? toPickedAsset(asset) : null;
  }
  await Promise.all(
    definition.fields
      .filter((field) => field.type === "entity" || field.type === "entity-list")
      .map(async (field) => {
        const kind = fieldKind(field, payload);
        refs[field.name] = kind ? await hydrateRefs(kind, idsOf(payload[field.name])) : [];
      }),
  );
  return { refs, media };
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export async function getSectionEditor(id: string, now: Date = new Date()): Promise<SectionEditorData | null> {
  const row = await db.contentSection.findUnique({
    where: { id },
    include: { blocks: { orderBy: { position: "asc" } } },
  });
  if (!row) return null;
  const definition = sectionDefinition(row.type);
  const payload = asObject<Record<string, unknown>>(row.payload, {});

  const blockMediaIds = row.blocks.map((block) => block.mediaId).filter((value): value is string => Boolean(value));
  const [assets, hydrated, linkRefs] = await Promise.all([
    getMediaAssets([row.imageMediaId, ...blockMediaIds].filter((value): value is string => Boolean(value))),
    hydratePayload(definition, payload),
    (() => {
      const kind = linkKind(row.linkType);
      return kind && row.linkTargetId ? hydrateRefs(kind, [row.linkTargetId]) : Promise.resolve([] as EntityRef[]);
    })(),
  ]);
  const asset = (mediaId: string | null) => {
    const found = mediaId ? assets.find((entry) => entry.id === mediaId) : undefined;
    return found ? toPickedAsset(found) : null;
  };

  return {
    id: row.id,
    key: row.key,
    type: row.type,
    title: row.title,
    subtitle: row.subtitle,
    position: row.position,
    enabled: row.enabled,
    publishAt: row.publishAt?.toISOString() ?? null,
    unpublishAt: row.unpublishAt?.toISOString() ?? null,
    image: asset(row.imageMediaId),
    linkType: row.linkType as LinkType,
    linkUrl: row.linkUrl,
    linkTargetId: row.linkTargetId,
    linkTarget: linkRefs[0] ?? null,
    buttonText: row.buttonText,
    payload,
    refs: hydrated.refs,
    media: hydrated.media,
    blocks: row.blocks.map((block, index) => {
      const blockPayload = asObject<Record<string, unknown>>(block.payload, {});
      return {
        id: block.id,
        position: block.position,
        enabled: block.enabled,
        publishAt: block.publishAt?.toISOString() ?? null,
        unpublishAt: block.unpublishAt?.toISOString() ?? null,
        payload: blockPayload,
        media: asset(block.mediaId),
        label: blockLabel(definition, blockPayload, index),
        state: scheduleState(block, now),
      };
    }),
    state: scheduleState(row, now),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getSectionPreview(id: string, now: Date = new Date()): Promise<SectionPreviewData | null> {
  const row = await db.contentSection.findUnique({ where: { id } });
  if (!row) return null;
  return previewSection(row, { now });
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function getFooterEditor(): Promise<FooterEditorData> {
  const row = await db.footerConfig.findUnique({ where: { id: "default" } });
  const service = asObject<Record<string, unknown>>(row?.customerService, {});
  const apps = asObject<Record<string, unknown>>(row?.appLinks, {});
  const socialLinks = (Array.isArray(row?.socialLinks) ? row.socialLinks : [])
    .map((item) => asObject<Record<string, unknown>>(item, {}))
    .map((item) => ({ platform: str(item.platform), url: str(item.url) }))
    .filter((item) => item.platform || item.url);
  const legalLinks = (Array.isArray(row?.legalLinks) ? row.legalLinks : [])
    .map((item) => asObject<Record<string, unknown>>(item, {}))
    .map((item) => ({ label: str(item.label), path: str(item.path) || str(item.url) }))
    .filter((item) => item.label || item.path);
  return {
    brandName: row?.brandName ?? "",
    brandDescription: row?.brandDescription ?? "",
    copyright: row?.copyright ?? "",
    socialLinks,
    customerService: { heading: str(service.heading), description: str(service.description), email: str(service.email) },
    legalLinks,
    paymentIcons: row?.paymentIcons ?? [],
    appLinks: { playStore: str(apps.playStore), appStore: str(apps.appStore) },
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}
