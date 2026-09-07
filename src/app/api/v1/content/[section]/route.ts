import { db } from "@/lib/db";
import {
  toAnnouncements,
  toHeroBanners,
  toPromoBanners,
  toPublicReviews,
  toReels,
  toSectionPayload,
  toTrustBadges,
} from "@/lib/serializers/public";
import { notFoundJson, publicJson } from "../../_lib/response";

/**
 * GET /api/v1/content/:section
 *
 * One endpoint covering everything the storefront's homeApi.js returns. The
 * slugs match the endpoint names already written (and commented out) in
 * contentApi.js, so the storefront's calls line up without renaming:
 *
 *   hero-banners · announcements · promo-banners · campaign
 *   craftsmanship · reviews · reels · trust-badges · newsletter
 *
 * Note for the cutover: contentApi.js is dead code that nothing imports, and
 * its axios instance points at a mockoon localhost base. homeApi.js is the live
 * adapter - that is the file to repoint.
 */

const SECTION_KEYS: Record<string, string> = {
  "hero-banners": "home.hero",
  announcements: "global.announcement_bar",
  "promo-banners": "global.promo_banners",
  campaign: "home.campaign_spotlight",
  craftsmanship: "home.brand_craftsmanship",
  reels: "home.reels",
  "trust-badges": "home.trust_badges",
  newsletter: "home.newsletter",
};

function isLive(section: {
  enabled: boolean;
  publishAt: Date | null;
  unpublishAt: Date | null;
}): boolean {
  const now = new Date();
  if (!section.enabled) return false;
  if (section.publishAt && now < section.publishAt) return false;
  if (section.unpublishAt && now > section.unpublishAt) return false;
  return true;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ section: string }> },
) {
  const { section } = await params;

  // Reviews come from the Review table, not from a content section.
  if (section === "reviews") {
    const reviews = await db.review.findMany({
      where: { status: "APPROVED", isFeatured: true },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
      take: 12,
      select: {
        authorName: true,
        authorLocation: true,
        body: true,
        rating: true,
      },
    });
    return publicJson(toPublicReviews(reviews));
  }

  const key = SECTION_KEYS[section];
  if (!key) return notFoundJson("Section");

  const record = await db.contentSection.findUnique({
    where: { key },
    include: { blocks: { orderBy: { position: "asc" } } },
  });

  if (!record) return notFoundJson("Section");

  // A disabled section returns an empty result rather than a 404: the
  // storefront components render nothing for an empty array, which is exactly
  // what "turned off in the admin" should look like.
  const live = isLive(record);

  const blocks = live
    ? record.blocks.filter((block) => {
        const now = new Date();
        if (block.publishAt && now < block.publishAt) return false;
        if (block.unpublishAt && now > block.unpublishAt) return false;
        return true;
      })
    : [];

  switch (section) {
    case "hero-banners":
      return publicJson(toHeroBanners(blocks));
    case "announcements":
      return publicJson(toAnnouncements(blocks));
    case "promo-banners":
      return publicJson(toPromoBanners(blocks));
    case "reels":
      return publicJson(toReels(blocks));
    case "trust-badges":
      return publicJson(toTrustBadges(blocks));
    case "campaign":
    case "craftsmanship":
    case "newsletter":
      // Singletons: the storefront destructures the object directly.
      return publicJson(live ? toSectionPayload(record.payload) : null);
    default:
      return notFoundJson("Section");
  }
}
