import { notFound } from "@/lib/api/errors";
import { handleOptions, publicCachedJson, withPublicApi } from "@/lib/api/public";
import { getMenuCached } from "@/features/storefront/cached";

/**
 * GET /api/v1/navigation/:menu - nested active items of a menu (main,
 * footer-1..3, mobile) with resolved `url` and an `isAvailable` flag that is
 * false when the target is missing, unpublished or inactive.
 */
export const GET = withPublicApi<{ menu: string }>(
  async ({ params }) => {
    const menu = await getMenuCached(params.menu);
    if (!menu) throw notFound("Menu");
    return publicCachedJson(menu);
  },
  { cached: true },
);

export const OPTIONS = handleOptions;
