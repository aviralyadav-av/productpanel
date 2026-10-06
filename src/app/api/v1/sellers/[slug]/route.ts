import { notFound } from "@/lib/api/errors";
import { handleOptions, withPublicApi } from "@/lib/api/public";
import { getSellerPageCached } from "@/features/storefront/cached";
import {
  PRODUCT_PAGE_SIZE_DEFAULT,
  PRODUCT_PAGE_SIZE_MAX,
  PRODUCT_SORTS,
  type ProductSort,
} from "@/features/storefront/queries/products";
import { parsePageInput } from "@/features/storefront/queries/shared";
import { publicCachedPage } from "@/features/storefront/respond";

/**
 * GET /api/v1/sellers/:slug?page=&pageSize=&sort= - an ACTIVE seller's public
 * profile (blueprint §14.D11 field list) plus a page of their product cards.
 * `/sellers/register/**` (intake) belongs to the sellers module (G4).
 */
export const GET = withPublicApi<{ slug: string }>(
  async ({ params, searchParams }) => {
    const { page, pageSize } = parsePageInput(searchParams, {
      defaultSize: PRODUCT_PAGE_SIZE_DEFAULT,
      maxSize: PRODUCT_PAGE_SIZE_MAX,
    });
    const sortRaw = (searchParams.get("sort") ?? "").trim();
    const sort: ProductSort = (PRODUCT_SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as ProductSort) : "position";

    const result = await getSellerPageCached(params.slug, page, pageSize, sort);
    if (!result) throw notFound("Seller");
    return publicCachedPage(result.data, result.meta);
  },
  { cached: true },
);

export const OPTIONS = handleOptions;
