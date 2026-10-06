import { validationError, zodDetails } from "@/lib/api/errors";
import { handleOptions, privateJson, withPublicApi } from "@/lib/api/public";

import { publicReturnSchema } from "@/features/returns/schemas";
import { submitPublicReturn } from "@/features/returns/public";

/**
 * POST /api/v1/returns   (blueprint §5.3, §14.D1, D9 20/min/IP, G4)
 *
 * body { orderNumber, token, orderItemId, quantity, reason, reasonDetail?,
 *        requestedResolution?, images?: uploadToken[] }
 * -> 201 { ok: true, rmaNumber, status }
 *
 * `token` is the D1 order access token from the confirmation email; it is
 * hashed and compared in constant time, and a wrong token answers with the
 * same 404 as an unknown order number so the endpoint cannot be used to
 * discover which orders exist. Photo tokens come from
 * POST /api/v1/uploads/review-image (the shared customer image intake).
 */
export const POST = withPublicApi(
  async ({ req, ip }) => {
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      throw validationError({ body: "Send a JSON body." }, "Invalid request body.");
    }
    const parsed = publicReturnSchema.safeParse(json);
    if (!parsed.success) throw validationError(zodDetails(parsed.error));

    const result = await submitPublicReturn({ values: parsed.data, ip });
    return privateJson({ ok: true, rmaNumber: result.rmaNumber, status: result.status, message: result.message }, { status: 201, req });
  },
  { rateLimit: { limit: 20, windowMs: 60_000 } },
);

export const OPTIONS = handleOptions;
