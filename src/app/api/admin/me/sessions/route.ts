import { z } from "zod";

import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";
import { recordAuthAudit } from "@/lib/auth/audit";
import { listUserSessions, revokeAdminSession, revokeUserSessions } from "@/lib/auth/session";
import { db } from "@/lib/db";

/**
 * The actor's OWN sessions (blueprint §14.D10). Cross-user session revoke is
 * the users module's `/api/admin/users/:id/sessions` with D3 rules.
 *
 *   GET    /api/admin/me/sessions            → { data: { sessions: OwnSessionRow[] } }
 *   DELETE /api/admin/me/sessions            → revoke every OTHER session
 *   DELETE /api/admin/me/sessions  { id }    → revoke one (own) session
 */
export const GET = withAdminApi(async ({ actor }) =>
  apiOk({ sessions: await listUserSessions(actor.id, actor.sessionId) }),
);

const deleteBody = z.object({ id: z.string().min(1).max(64).optional() });

export const DELETE = withAdminApi(
  async ({ req, actor, ip }) => {
    const hasBody = req.headers.get("content-length") !== "0" && req.headers.get("content-type");
    const body = hasBody ? await parseJsonBody(req, deleteBody) : {};
    const userAgent = req.headers.get("user-agent");

    if (body.id) {
      const row = await db.adminSession.findFirst({
        where: { id: body.id, userId: actor.id },
        select: { id: true, deviceLabel: true },
      });
      if (!row) throw notFound("Session");
      const revoked = await revokeAdminSession(row.id);
      await recordAuthAudit({
        userId: actor.id,
        email: actor.email,
        action: "auth.session_revoked",
        summary: `${actor.email} revoked a session (${row.deviceLabel ?? "unknown device"})`,
        entityType: "admin_session",
        entityId: row.id,
        ip,
        userAgent,
      });
      return apiOk({ revoked: revoked ? 1 : 0, wasCurrent: row.id === actor.sessionId });
    }

    const revoked = await revokeUserSessions(actor.id, { exceptSessionId: actor.sessionId });
    await recordAuthAudit({
      userId: actor.id,
      email: actor.email,
      action: "auth.session_revoked",
      summary: `${actor.email} signed out ${revoked} other device${revoked === 1 ? "" : "s"}`,
      entityType: "admin_session",
      entityId: actor.sessionId,
      diff: { revoked },
      ip,
      userAgent,
    });
    return apiOk({ revoked, wasCurrent: false });
  },
  { rateLimit: { limit: 30, windowMs: 60_000 } },
);
