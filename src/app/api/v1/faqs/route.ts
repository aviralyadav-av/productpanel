import { handleOptions, publicCachedJson, withPublicApi } from "@/lib/api/public";
import { getFaqGroupsCached } from "@/features/storefront/cached";

/** GET /api/v1/faqs - enabled FAQs grouped by `group`, in position order. */
export const GET = withPublicApi(async () => publicCachedJson(await getFaqGroupsCached()), { cached: true });

export const OPTIONS = handleOptions;
