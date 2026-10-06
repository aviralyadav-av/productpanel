import { validationError, zodDetails } from "@/lib/api/errors";
import { handleOptions, privateJson, withPublicApi } from "@/lib/api/public";

import { subscribeSchema } from "@/features/newsletter/schemas";
import { subscribeFromPublic } from "@/features/newsletter/service";

/**
 * POST /api/v1/newsletter/subscribe   (blueprint §5.3, §14.D9 5/h/IP, E3)
 * body { email, name?, source?, website? (honeypot) }
 *
 * Creates or reactivates the subscriber and queues `newsletter_welcome` with
 * an `unsubscribe_url` pointing at GET /api/v1/newsletter/unsubscribe/:token.
 * The answer is identical for a new address, an address already on the list
 * and a bot, so the endpoint cannot be used to probe who our customers are.
 * -> 200 { ok: true, message }
 */
export const POST = withPublicApi(
  async ({ req, ip }) => {
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      throw validationError({ body: "Send a JSON body." }, "Invalid request body.");
    }
    const parsed = subscribeSchema.safeParse(json);
    if (!parsed.success) throw validationError(zodDetails(parsed.error));

    const result = await subscribeFromPublic({ values: parsed.data, ip: ip === "unknown" ? null : ip });
    return privateJson({ ok: true, message: result.message }, { req });
  },
  { rateLimit: { limit: 5, windowMs: 60 * 60 * 1000 } },
);

export const OPTIONS = handleOptions;
