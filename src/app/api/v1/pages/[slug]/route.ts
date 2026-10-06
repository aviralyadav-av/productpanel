import { notFound } from "@/lib/api/errors";
import { handleOptions, privateJson, publicCachedJson, withPublicApi } from "@/lib/api/public";
import { getPageCached } from "@/features/storefront/cached";
import { findPageIdBySlug, getPage } from "@/features/storefront/queries/pages";
import { assertPreviewAllowed, previewTokenOf } from "@/features/storefront/respond";

/**
 * GET /api/v1/pages/:slug - a PUBLISHED CMS page with sanitised HTML
 * (blueprint §14.E5, D12). `?preview=<token>` for the `page` entity shows a
 * draft, uncached (E6).
 */
export const GET = withPublicApi<{ slug: string }>(
  async ({ req, params, searchParams }) => {
    const token = previewTokenOf(searchParams);
    if (token) {
      assertPreviewAllowed(token, "page", await findPageIdBySlug(params.slug), "Page");
      const draft = await getPage(params.slug, { preview: true });
      if (!draft) throw notFound("Page");
      return privateJson(draft, { req });
    }
    const page = await getPageCached(params.slug);
    if (!page) throw notFound("Page");
    return publicCachedJson(page);
  },
  { cached: true },
);

export const OPTIONS = handleOptions;
