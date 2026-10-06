import type { NextAuthConfig } from "next-auth";

/**
 * The base Auth.js config. Deliberately free of Prisma and bcrypt so it can be
 * imported by proxy.ts without dragging the database driver into the request
 * path on every navigation.
 *
 * The Credentials provider and the sign-out event - the parts that need the
 * database - are added in ./index.ts, which is what the route handler and
 * server code import.
 */

/**
 * Ceiling for the signed cookie. The REAL lifetime is `AdminSession.expiresAt`
 * (setting `security.session_hours`, default 12 h) plus the idle timeout, both
 * enforced by getActor() against the row; the JWT only has to outlive the
 * longest session an operator may configure so it never expires first.
 */
export const JWT_MAX_AGE_SECONDS = 60 * 60 * 24;

/**
 * Production cookie per blueprint §14.D10: `__Host-` prefix (browser refuses
 * it unless Secure, Path=/ and no Domain - so a sibling subdomain can never
 * plant a session cookie), httpOnly, SameSite=Lax. Development keeps Auth.js
 * defaults because `__Host-` cookies are rejected over plain http.
 */
const PRODUCTION_COOKIES: NextAuthConfig["cookies"] =
  process.env.NODE_ENV === "production"
    ? {
        sessionToken: {
          name: "__Host-authjs.session-token",
          options: { httpOnly: true, sameSite: "lax", path: "/", secure: true },
        },
      }
    : undefined;

export const authConfig = {
  // A Credentials provider cannot use database sessions in Auth.js, so the
  // session is a signed JWT. That makes the token a CACHE of the identity, not
  // the source of truth: the guards re-read the user row, role, permissions
  // AND the AdminSession row on every request, so a deactivated or demoted
  // admin - or a revoked session - loses access immediately.
  session: {
    strategy: "jwt",
    maxAge: JWT_MAX_AGE_SECONDS,
    updateAge: 60 * 15,
  },

  pages: {
    signIn: "/admin/login",
    error: "/admin/login",
  },

  trustHost: true,

  cookies: PRODUCTION_COOKIES,

  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id as string;
        token.roleSlug = user.roleSlug ?? null;
        token.sessionId = user.sessionId ?? null;
        token.pendingMfa = user.pendingMfa ?? false;
      }

      // `unstable_update({ pendingMfa: false })` after a successful 2FA
      // challenge. Only this one claim may be flipped from the outside, and
      // only server code calls update, so the payload is trusted narrowly.
      if (trigger === "update" && session && typeof session === "object") {
        const next = (session as { pendingMfa?: unknown }).pendingMfa;
        if (typeof next === "boolean") token.pendingMfa = next;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.roleSlug = (token.roleSlug as string | null | undefined) ?? null;
      }
      session.sessionId = (token.sessionId as string | null | undefined) ?? null;
      session.pendingMfa = Boolean(token.pendingMfa);
      return session;
    },
  },

  providers: [],
} satisfies NextAuthConfig;
