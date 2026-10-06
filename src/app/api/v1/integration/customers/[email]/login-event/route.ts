import { parseJsonBody } from "@/lib/api/admin";
import { privateJson, withPublicApi } from "@/lib/api/public";

import { decodeParam, guardIntegration } from "@/features/customers/integration-guard";
import { recordLoginEvent } from "@/features/customers/integration-service";
import { integrationLoginEventSchema } from "@/features/customers/schemas";

/**
 * POST /api/v1/integration/customers/:email/login-event   (X-Storefront-Key; 600/min per key)
 * body: { at?, ip?, userAgent?, sessionToken?, expiresAt? }
 * -> { customerId, lastLoginAt, sessionId }. Updates lastLoginAt and mirrors the session (token hashed) for the admin Activity tab.
 * 400 when the customer is blocked, 404 when unknown.
 */
export const POST = withPublicApi<{ email: string }>(
  async ({ req, params }) => {
    await guardIntegration(req);
    const input = await parseJsonBody(req, integrationLoginEventSchema);
    return privateJson(await recordLoginEvent(decodeParam(params.email), input), { req });
  },
  { rateLimit: { limit: 600, windowMs: 60_000 } },
);

export const OPTIONS = POST;
