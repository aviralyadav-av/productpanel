import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { emailTestSchema } from "@/features/settings/schemas";
import { sendTestEmail, testSmtpSettings } from "@/features/settings/service";

/**
 * POST /api/admin/settings/email/test { mode: "connection" | "send", to?, values? }
 * (settings.manage, 10/min/actor)
 *
 * `values` carries the unsaved form values so the buttons test what is on
 * screen rather than what was last saved; anything omitted falls back to the
 * stored setting. Rate limited because "send" queues a real email.
 */
export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const body = await parseJsonBody(req, emailTestSchema);

    if (body.mode === "connection") {
      return apiOk({ mode: "connection", ...(await testSmtpSettings(body.values)) });
    }

    const result = await sendTestEmail(body.to?.trim() || actor.email, actor, { ip });
    return apiOk({ mode: "send", ...result });
  },
  { permission: "settings.manage", rateLimit: { limit: 10, windowMs: 60_000 } },
);
