import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "@/lib/db";
import { clientIp } from "@/lib/client-ip";
import { authConfig } from "./config";
import { recordAuthAudit } from "./audit";
import {
  checkLoginBackoff,
  checkLoginIpLimit,
  recordLoginAttempt,
} from "./login-policy";
import { createAdminSession, revokeAdminSession } from "./session";

export const credentialsSchema = z.object({
  email: z.email({ message: "Enter a valid email address." }),
  password: z.string().min(1, { message: "Enter your password." }),
});

/**
 * Compared against when the email is unknown so the response time does not
 * reveal which addresses are registered (bcrypt cost 12, like real hashes).
 */
const DUMMY_HASH = "$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function requestMeta(request: Request | undefined) {
  const headers = request?.headers ?? new Headers();
  return {
    ip: clientIp(headers),
    userAgent: headers.get("user-agent"),
  };
}

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },

      /**
       * Returning null is the only failure signal Auth.js gives a credentials
       * provider, so every refusal - bad password, inactive user, rate limit,
       * backoff - looks identical to the browser (D9 "uniform error"). The
       * distinguishing detail goes to LoginAttempt and the audit log instead.
       */
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const email = parsed.data.email.toLowerCase().trim();
        const { ip, userAgent } = requestMeta(request);

        // D9: the per-IP wall first, before any per-account work.
        const ipGate = await checkLoginIpLimit(ip);
        if (!ipGate.allowed) {
          await recordAuthAudit({
            email,
            action: "auth.login_failed",
            summary: `Sign-in refused for ${email}: IP rate limit`,
            diff: { reason: "ip_limited", retryAfterSec: ipGate.retryAfterSec },
            ip,
            userAgent,
          });
          return null;
        }

        // Then per-email backoff. Refusals inside the window are not recorded
        // as fresh failures, otherwise a script could grow the delay forever.
        const backoff = await checkLoginBackoff(email);
        if (!backoff.allowed) {
          await recordAuthAudit({
            email,
            action: "auth.login_failed",
            summary: `Sign-in refused for ${email}: backoff (${backoff.retryAfterSec}s)`,
            diff: { reason: "backoff", retryAfterSec: backoff.retryAfterSec },
            ip,
            userAgent,
          });
          return null;
        }

        const user = await db.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            passwordHash: true,
            isActive: true,
            deletedAt: true,
            twoFactorEnabled: true,
            role: { select: { slug: true } },
          },
        });

        const valid = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);

        if (!user || !valid || !user.isActive || user.deletedAt) {
          await recordLoginAttempt({ email, success: false, ip, userAgent });
          await recordAuthAudit({
            // Only attach the user when the row exists; an inactive account's
            // failures should still show on its audit timeline.
            userId: user?.id ?? null,
            email,
            action: "auth.login_failed",
            summary: `Failed sign-in for ${email}`,
            diff: {
              reason: !user ? "unknown_email" : !valid ? "bad_password" : "inactive",
            },
            ip,
            userAgent,
          });
          return null;
        }

        // D2: the session row is born pending when the user has 2FA; the
        // guards refuse everything but the challenge page until it is verified.
        const session = await createAdminSession({
          userId: user.id,
          twoFactorEnabled: user.twoFactorEnabled,
          ip,
          userAgent,
        });

        await Promise.all([
          recordLoginAttempt({ email, success: true, ip, userAgent }),
          db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
          recordAuthAudit({
            userId: user.id,
            email,
            action: "auth.login_success",
            summary: `${email} signed in${user.twoFactorEnabled ? " (2FA pending)" : ""}`,
            entityType: "admin_session",
            entityId: session.id,
            ip,
            userAgent,
          }),
        ]);

        // A user without a role authenticates but is refused by the guards, so
        // the operator can tell "wrong password" from "no access".
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          roleSlug: user.role?.slug ?? null,
          sessionId: session.id,
          pendingMfa: user.twoFactorEnabled,
        };
      },
    }),
  ],

  events: {
    /**
     * Backstop for the explicit revoke in signOutAction: also fires when the
     * cookie is cleared through /api/auth/signout directly, so a row never
     * outlives its cookie by more than the request that ended it.
     */
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      const sessionId = token?.sessionId;
      if (typeof sessionId === "string" && sessionId) {
        await revokeAdminSession(sessionId).catch((error) =>
          console.error("SESSION REVOKE ON SIGNOUT FAILED", error),
        );
      }
    },
  },
});
