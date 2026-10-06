import { notFound } from "@/lib/api/errors";
import { handleOptions, privateJson, publicCachedJson, withPublicApi } from "@/lib/api/public";
import { db } from "@/lib/db";
import { getProductDetailCached } from "@/features/storefront/cached";
import { findProductIdBySlug, getProductDetail } from "@/features/storefront/queries/products";
import { assertPreviewAllowed, previewTokenOf } from "@/features/storefront/respond";

/**
 * GET /api/v1/products/:slug - product detail (blueprint §5.3, §14.A10, E6).
 *
 * `?preview=<token>` (minted by the admin for THIS product) bypasses both the
 * cache and the published/seller filter and answers `no-store`; a bad or
 * foreign token is a 404 indistinguishable from a missing product.
 *
 * The view counter is bumped AFTER the response is built, unawaited and
 * outside the cached function: a cached hit must not count zero and a cache
 * fill must not count once per revalidation. Failures are swallowed - a
 * broken counter is not a reason to fail a product page.
 */
export const GET = withPublicApi<{ slug: string }>(
  async ({ req, params, searchParams }) => {
    const token = previewTokenOf(searchParams);
    if (token) {
      assertPreviewAllowed(token, "product", await findProductIdBySlug(params.slug), "Product");
      const draft = await getProductDetail(params.slug, { preview: true });
      if (!draft) throw notFound("Product");
      return privateJson(draft, { req });
    }

    const product = await getProductDetailCached(params.slug);
    if (!product) throw notFound("Product");

    void db.product
      .update({ where: { id: product.id }, data: { viewCount: { increment: 1 } }, select: { id: true } })
      .catch(() => undefined);

    return publicCachedJson(product);
  },
  { cached: true },
);

export const OPTIONS = handleOptions;
