import { apiCreated, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { sendTestEmail } from "@/features/email/templates-service";
import { testSendSchema } from "@/features/email/templates-schemas";

/**
 * POST /api/admin/email-templates/:id/test-send  { vars? }
 *
 * Queues the rendered template to the CALLER's own admin address - there is
 * deliberately no `to` parameter. An admin endpoint that mails arbitrary
 * HTML to an arbitrary address is a spam relay with a login page.
 *
 * Rate-limited per actor because it is the one endpoint here that produces
 * outbound mail on demand.
 */
export const POST = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const body = await parseJsonBody(req, testSendSchema);
    const result = await sendTestEmail({
      id: params.id,
      actor,
      vars: body.vars,
      meta: { ip, userAgent: req.headers.get("user-agent") },
    });
    return apiCreated(result);
  },
  {
    permission: "email_templates.manage",
    rateLimit: { limit: 30, windowMs: 60 * 60_000, keyBy: "actor" },
  },
);
