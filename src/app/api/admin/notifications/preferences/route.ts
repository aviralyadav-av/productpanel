import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { preferencesSchema } from "@/features/notifications/schemas";
import { savePreferences } from "@/features/notifications/preferences";
import { getPreferences } from "@/features/notifications/service";

/**
 * GET|PUT /api/admin/notifications/preferences (blueprint §5.2)
 *
 * The actor's own delivery matrix: one row per NOTIFICATION_TYPES value with
 * the effective setting (defaults filled in for types the user has never
 * touched) and the permission that gates it, so a client can explain why a
 * type never arrives.
 *
 * PUT accepts the whole matrix and writes only the rows that changed; the
 * change is audited as `notification.preferences_update`.
 */
export const GET = withAdminApi(
  async ({ actor }) => apiOk(await getPreferences(actor.id)),
  { permission: "notifications.view" },
);

export const PUT = withAdminApi(
  async ({ req, actor, ip }) => {
    const body = await parseJsonBody(req, preferencesSchema);
    const result = await savePreferences(actor, body.preferences, {
      ip,
      userAgent: req.headers.get("user-agent"),
    });
    return apiOk({ ...result, preferences: await getPreferences(actor.id) });
  },
  { permission: "notifications.view" },
);
