import { notFound } from "@/lib/api/errors";
import { handleOptions, privateJson, withPublicApi } from "@/lib/api/public";

import { getPublicReturn } from "@/features/returns/public";

/**
 * GET /api/v1/returns/:rma?token=   (§14.D1, D9 20/min/IP, D11)
 *
 * The customer's view of one RMA, authenticated by the same order access
 * token as order tracking. An explicit allowlist: no internal events, no QC
 * notes, no seller, no provider ids. An unknown RMA and a wrong token are
 * reported identically.
 */
export const GET = withPublicApi<{ rma: string }>(
  async ({ req, params, searchParams }) => {
    const result = await getPublicReturn(decodeURIComponent(params.rma), searchParams.get("token"));
    if (!result) throw notFound("Return request");
    return privateJson({ return: result }, { req });
  },
  { rateLimit: { limit: 20, windowMs: 60_000 } },
);

export const OPTIONS = handleOptions;
