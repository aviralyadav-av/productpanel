import { notFound, validationError, zodDetails } from "@/lib/api/errors";
import { handleOptions, privateJson, withPublicApi } from "@/lib/api/public";
import { listProductReviewsCached } from "@/features/storefront/cached";
import { REVIEW_PAGE_SIZE_DEFAULT, REVIEW_PAGE_SIZE_MAX } from "@/features/storefront/queries/products";
import { parsePageInput } from "@/features/storefront/queries/shared";
import { publicCachedPage } from "@/features/storefront/respond";
import { publicReviewSchema } from "@/features/reviews/schemas";
import { submitPublicReview } from "@/features/reviews/service";

/**
 * GET /api/v1/products/:slug/reviews - APPROVED reviews, newest first,
 * `?page=&pageSize=` (≤50). POST (review intake) is owned by the reviews
 * module (blueprint §14.G4) and is added to this file by that owner.
 */
export const GET = withPublicApi<{ slug: string }>(
  async ({ params, searchParams }) => {
    const { page, pageSize } = parsePageInput(searchParams, {
      defaultSize: REVIEW_PAGE_SIZE_DEFAULT,
      maxSize: REVIEW_PAGE_SIZE_MAX,
    });
    const result = await listProductReviewsCached(params.slug, page, pageSize);
    if (!result) throw notFound("Product");
    return publicCachedPage(result.data, result.meta);
  },
  { cached: true },
);

/**
 * POST /api/v1/products/:slug/reviews   (blueprint §5.3, §14.D9 5/h/IP, E3)
 * body { authorName, email?, rating 1-5, title?, body, images?: uploadToken[], orderNumber?, token?, website? (honeypot) }
 * Lands as PENDING; `orderNumber` + the checkout access `token` for an order
 * containing this product mark it a verified purchase. Photo tokens come from
 * POST /api/v1/uploads/review-image.
 * -> 201 { ok: true, message, isVerifiedPurchase }   (no review id: pending reviews are not public)
 */
export const POST = withPublicApi<{ slug: string }>(
  async ({ req, params, ip }) => {
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      throw validationError({ body: "Send a JSON body." }, "Invalid request body.");
    }
    const parsed = publicReviewSchema.safeParse(json);
    if (!parsed.success) throw validationError(zodDetails(parsed.error));

    const result = await submitPublicReview({ slug: params.slug, values: parsed.data, ip });
    return privateJson({ ok: true, message: result.message, isVerifiedPurchase: result.isVerifiedPurchase }, { status: 201, req });
  },
  { rateLimit: { limit: 5, windowMs: 60 * 60 * 1000 } },
);

export const OPTIONS = handleOptions;
