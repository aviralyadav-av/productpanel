import { badRequest, rateLimited, validationError, zodDetails } from "@/lib/api/errors";
import { handleOptions, privateJson, withPublicApi } from "@/lib/api/public";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";

import { registerSellerSchema } from "@/features/sellers/schemas";
import { REGISTRATION_ACCEPTED_MESSAGE, registerSeller } from "@/features/sellers/service";

/**
 * POST /api/v1/sellers/register   (blueprint §14.C6, D9)
 *
 * Body: { ownerName, displayName, legalName?, email, phone, password?,
 *         addressLine1, addressLine2?, city, state, pinCode, gstin?, pan?,
 *         description?, documents?: [{ type, uploadToken, label? }] }
 * 200: { data: { ok: true, message } } - identical whether or not the email
 *      already belongs to a seller (no enumeration).
 * 403 when `marketplace.seller_registration_open` is off; 422 on validation;
 * 400 when an upload token is unknown or expired; 429 at 10/h per IP or
 * 3/day per email.
 */
export const POST = withPublicApi(
  async ({ req, ip }) => {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw badRequest("Request body must be valid JSON.");
    }
    const parsed = registerSellerSchema.safeParse(raw);
    if (!parsed.success) throw validationError(zodDetails(parsed.error));

    const perEmail = await rateLimit(rateLimitKey("seller-register", "email", parsed.data.email), {
      limit: 3,
      windowMs: 24 * 60 * 60_000,
    });
    if (!perEmail.ok) throw rateLimited(perEmail.retryAfterSec);

    await registerSeller(parsed.data, { ip: ip === "unknown" ? null : ip });
    return privateJson({ ok: true, message: REGISTRATION_ACCEPTED_MESSAGE }, { req });
  },
  { rateLimit: { limit: 10, windowMs: 60 * 60_000 } },
);

export const OPTIONS = handleOptions;
