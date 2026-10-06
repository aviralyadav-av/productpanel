import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * Audit rows for AUTHENTICATION events (blueprint §14.D13): login success and
 * failure, logout, password reset, 2FA enable/disable, session revoke.
 *
 * `writeAudit()` in src/lib/audit.ts wants a resolved Actor and reads the
 * request headers itself, which is right for a signed-in operator changing a
 * product. Auth events are different: a failed login has no actor (or an
 * unknown email), authorize() runs inside Auth.js rather than a Server Action,
 * and the sign-out event fires after the request context is gone. So this
 * helper takes an optional user id, the email as typed, and explicit ip /
 * user agent, and writes the same append-only row.
 *
 * Like writeAudit, failures are logged and swallowed - an audit hiccup must
 * never turn a valid sign-in into an error page.
 */
export type AuthAuditInput = {
  /** The user the event concerns, when known. Must be a real User id (FK). */
  userId?: string | null;
  /** The email as typed, lower-cased by the caller; kept even for unknown users. */
  email: string;
  /** e.g. auth.login_success, auth.login_failed, auth.logout, auth.password_reset */
  action: string;
  summary: string;
  entityType?: string;
  entityId?: string | null;
  diff?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
  tx?: Prisma.TransactionClient;
};

export async function recordAuthAudit(input: AuthAuditInput): Promise<void> {
  try {
    await (input.tx ?? db).auditLog.create({
      data: {
        actorId: input.userId ?? null,
        actorEmail: input.email,
        action: input.action,
        entityType: input.entityType ?? "user",
        entityId: input.entityId ?? input.userId ?? null,
        summary: input.summary,
        diff: input.diff,
        ip: input.ip ?? null,
        userAgent: input.userAgent?.slice(0, 512) ?? null,
      },
    });
  } catch (error) {
    console.error("AUTH AUDIT WRITE FAILED", input.action, error);
  }
}
