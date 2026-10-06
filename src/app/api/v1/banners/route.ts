import { badRequest } from "@/lib/api/errors";
import { handleOptions, publicCachedJson, withPublicApi } from "@/lib/api/public";
import { BANNER_PLACEMENTS } from "@/lib/enums";
import { getBannersCached } from "@/features/storefront/cached";

/**
 * GET /api/v1/banners?placement=HOME_HERO - active in-window banners for a
 * placement with their link resolved to a storefront URL. Without
 * `placement` every live banner is returned (grouped by `placement` on the
 * client). An unknown placement is a 400, not an empty list, so a typo in
 * the website's code is noticed.
 */
export const GET = withPublicApi(
  async ({ searchParams }) => {
    const placement = (searchParams.get("placement") ?? "").trim() || null;
    if (placement && !(BANNER_PLACEMENTS as readonly string[]).includes(placement)) {
      throw badRequest(`Unknown placement. Expected one of: ${BANNER_PLACEMENTS.join(", ")}.`);
    }
    return publicCachedJson(await getBannersCached(placement));
  },
  { cached: true },
);

export const OPTIONS = handleOptions;
