import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { asObject } from "@/lib/json";
import { sanitizeHtml } from "@/lib/sanitize/html";
import { MEDIA_SELECT, publicMediaUrl, serializeImage, type PublicHomeSection } from "@/lib/serializers/public";
import { inPublishWindow, sectionDefinition, sectionLinkOf, type HomeResolver } from "@/features/content/registry";
import { HOME_RESOLVERS } from "../home-resolvers";
import { NO_LINK, STOREFRONT_PATHS, resolveLink, type PublicLink } from "../links";

/**
 * `/api/v1/home` (blueprint §14.E1): enabled, in-window sections of the
 * `home` page in position order, each with its resolved `items`.
 *
 * One broken section (a resolver throwing on a bad payload, a deleted target)
 * degrades to `items: []` with a server-side warning; it never takes the whole
 * homepage down - the storefront's landing page is the one response that
 * must always come back.
 */

type Db = Prisma.TransactionClient;
type Section = Parameters<HomeResolver>[0];

const SECTION_SELECT = {
  id: true,
  key: true,
  type: true,
  title: true,
  subtitle: true,
  position: true,
  enabled: true,
  publishAt: true,
  unpublishAt: true,
  linkType: true,
  linkUrl: true,
  linkTargetId: true,
  buttonText: true,
  imageMediaId: true,
  payload: true,
  image: { select: MEDIA_SELECT },
} satisfies Prisma.ContentSectionSelect;

/**
 * Payload keys that are admin-side plumbing (id lists the resolvers consume,
 * link fields resolved into `link`, media ids resolved into URLs).
 */
const INTERNAL_SETTING_KEYS = new Set([
  "productIds",
  "categoryIds",
  "sellerIds",
  "reviewIds",
  "categoryId",
  "linkType",
  "linkUrl",
  "linkTargetId",
  "imageMediaId",
  "mobileImageMediaId",
]);

/** Resolve a section link whose target is an id of the `linkType` entity. */
async function resolveTargetLink(
  client: Db,
  link: { linkType: string; linkUrl: string | null; linkTargetId: string | null },
): Promise<PublicLink> {
  const id = link.linkTargetId;
  switch (link.linkType) {
    case "NONE":
      return NO_LINK;
    case "URL":
      return resolveLink({ linkType: "URL", linkUrl: link.linkUrl });
    case "CATEGORY": {
      const category = id ? await client.category.findUnique({ where: { id }, select: { path: true, isActive: true } }) : null;
      return resolveLink({ linkType: "CATEGORY", category });
    }
    case "PRODUCT": {
      const product = id
        ? await client.product.findUnique({
            where: { id },
            select: { slug: true, status: true, deletedAt: true, seller: { select: { status: true, deletedAt: true } } },
          })
        : null;
      return resolveLink({ linkType: "PRODUCT", product });
    }
    case "PAGE": {
      const page = id ? await client.cmsPage.findUnique({ where: { id }, select: { slug: true, status: true } }) : null;
      return resolveLink({ linkType: "PAGE", page });
    }
    case "BLOG": {
      const blog = id
        ? await client.blogPost.findUnique({ where: { id }, select: { slug: true, status: true, publishedAt: true } })
        : null;
      return blog ? resolveLink({ linkType: "BLOG", blog }) : resolveLink({ linkType: "BLOG", linkUrl: link.linkUrl });
    }
    default:
      return NO_LINK;
  }
}

async function mediaUrl(client: Db, id: unknown): Promise<string | null> {
  if (typeof id !== "string" || !id.trim()) return null;
  const asset = await client.mediaAsset.findFirst({
    where: { id: id.trim(), visibility: "PUBLIC" },
    select: { url: true },
  });
  return publicMediaUrl(asset?.url);
}

/**
 * The public `settings`: the payload minus internal keys, with the promo
 * section's media/link resolved, rich text re-sanitised (D12) and a
 * `category` summary for sections scoped to one.
 */
async function buildSettings(client: Db, section: Section): Promise<Record<string, unknown>> {
  const settings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(section.payload)) {
    if (INTERNAL_SETTING_KEYS.has(key) || /Ids?$/.test(key)) continue;
    settings[key] = key === "html" && typeof value === "string" ? sanitizeHtml(value, "rich") : value;
  }

  if (section.type === "promo_section") {
    const [image, mobileImage] = await Promise.all([
      mediaUrl(client, section.payload.imageMediaId),
      mediaUrl(client, section.payload.mobileImageMediaId),
    ]);
    settings.image = image;
    settings.mobileImage = mobileImage;
    settings.link = await resolveTargetLink(client, sectionLinkOf(section));
  }

  const categoryId = section.payload.categoryId;
  if (typeof categoryId === "string" && categoryId) {
    const category = await client.category.findFirst({
      where: { id: categoryId, isActive: true },
      select: { slug: true, name: true, path: true },
    });
    settings.category = category
      ? { slug: category.slug, name: category.name, url: STOREFRONT_PATHS.category(category.path) }
      : null;
  }
  return settings;
}

export async function getHome(tx?: Db): Promise<PublicHomeSection[]> {
  const client = tx ?? db;
  const now = new Date();
  const rows = await client.contentSection.findMany({
    where: { page: "home", enabled: true },
    orderBy: [{ position: "asc" }, { key: "asc" }],
    select: SECTION_SELECT,
  });

  const live = rows.filter((row) => inPublishWindow(row, now));
  return Promise.all(
    live.map(async (row): Promise<PublicHomeSection> => {
      const section: Section = {
        id: row.id,
        key: row.key,
        type: row.type,
        title: row.title,
        subtitle: row.subtitle,
        payload: asObject<Record<string, unknown>>(row.payload, {}),
        linkType: row.linkType,
        linkUrl: row.linkUrl,
        linkTargetId: row.linkTargetId,
        buttonText: row.buttonText,
        imageMediaId: row.imageMediaId,
      };
      const definition = sectionDefinition(row.type);
      const resolver = HOME_RESOLVERS[definition.resolver];

      const [items, link, settings] = await Promise.all([
        resolver(section, { tx, now }).catch((error: unknown) => {
          console.warn(`[home] section ${row.key} (${row.type}) failed to resolve`, error);
          return [] as unknown[];
        }),
        definition.supportsLink ? resolveTargetLink(client, sectionLinkOf(section)) : Promise.resolve(NO_LINK),
        buildSettings(client, section),
      ]);

      return {
        key: row.key,
        type: row.type,
        title: row.title,
        subtitle: row.subtitle,
        image: serializeImage(row.image),
        link,
        buttonText: row.buttonText,
        settings,
        items,
      };
    }),
  );
}
