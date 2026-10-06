import { BANNER_PLACEMENTS, BANNER_PLACEMENT_META, type BannerPlacement } from "@/lib/enums";

/**
 * What each placement IS on the storefront (blueprint §4.7, §14.E1). Labels
 * come from the frozen enum metadata; the descriptions, aspect ratios and
 * recommended sizes live here because the banner editor is the only screen
 * that needs them. `hero_slider` and `promo_banners` homepage sections read
 * HOME_HERO / HOME_PROMO respectively - Banners is the single editor for
 * slide content, Homepage only orders and schedules the section (E1).
 */

export type PlacementInfo = {
  placement: BannerPlacement;
  label: string;
  description: string;
  /** Desktop aspect ratio as w/h, used by the preview and the card thumbnail. */
  aspect: number;
  recommended: string;
  /** Whether the storefront shows several banners in this placement at once. */
  multiple: boolean;
  /** Placements that are text-first (announcement, checkout) do not need a hero-sized image. */
  imageOptional: boolean;
};

const DETAILS: Record<BannerPlacement, Omit<PlacementInfo, "placement" | "label">> = {
  HOME_HERO: {
    description: "Slides in the homepage hero slider (the hero_slider section). Order here is the slide order.",
    aspect: 16 / 6,
    recommended: "1920 × 720 desktop, 1080 × 1080 mobile",
    multiple: true,
    imageOptional: false,
  },
  HOME_PROMO: {
    description: "Promotional tiles below the hero (the promo_banners section), shown as a grid or strip.",
    aspect: 4 / 3,
    recommended: "1200 × 900",
    multiple: true,
    imageOptional: false,
  },
  HOME_STRIP: {
    description: "A full-width strip further down the homepage - one banner at a time.",
    aspect: 16 / 4,
    recommended: "1920 × 480",
    multiple: false,
    imageOptional: false,
  },
  CATEGORY_TOP: {
    description: "Above the product grid on category pages; link it to the category it decorates.",
    aspect: 16 / 5,
    recommended: "1920 × 600",
    multiple: false,
    imageOptional: false,
  },
  SIDEBAR: {
    description: "Tall tiles beside listings and blog posts.",
    aspect: 3 / 4,
    recommended: "600 × 800",
    multiple: true,
    imageOptional: false,
  },
  POPUP: {
    description: "The one-time modal shown to first-time visitors. Keep exactly one live at a time.",
    aspect: 1,
    recommended: "900 × 900",
    multiple: false,
    imageOptional: false,
  },
  ANNOUNCEMENT: {
    description: "The thin bar at the very top of every page - text and a link, background colour instead of an image.",
    aspect: 16 / 1,
    recommended: "Text only; colours set the look",
    multiple: true,
    imageOptional: true,
  },
  CHECKOUT: {
    description: "A reassurance or offer strip on the checkout page, e.g. the free-shipping threshold.",
    aspect: 16 / 3,
    recommended: "1200 × 225 or text only",
    multiple: false,
    imageOptional: true,
  },
};

export const BANNER_PLACEMENT_INFO: readonly PlacementInfo[] = BANNER_PLACEMENTS.map((placement) => ({
  placement,
  label: BANNER_PLACEMENT_META[placement].label,
  ...DETAILS[placement],
}));

export function placementInfo(placement: string): PlacementInfo {
  return BANNER_PLACEMENT_INFO.find((info) => info.placement === placement) ?? BANNER_PLACEMENT_INFO[0];
}
