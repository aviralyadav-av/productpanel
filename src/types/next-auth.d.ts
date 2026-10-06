import type { DefaultSession } from "next-auth";

/**
 * The JWT carries the user id, a CACHE of the role slug, the AdminSession row
 * id and the pending-2FA flag (blueprint §14.D2). Authorization never trusts
 * these claims: guards re-read the user, role, permissions AND the session row
 * on every request. `pendingMfa` exists in the token only so proxy.ts - which
 * cannot reach the database - can keep a half-verified session on the
 * /admin/two-factor page; it is flipped by `unstable_update` after the code
 * is accepted and re-derived from `AdminSession.mfaVerifiedAt` by getActor().
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      roleSlug: string | null;
    } & DefaultSession["user"];
    sessionId?: string | null;
    pendingMfa?: boolean;
  }

  interface User {
    roleSlug?: string | null;
    sessionId?: string | null;
    pendingMfa?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    roleSlug?: string | null;
    sessionId?: string | null;
    pendingMfa?: boolean;
  }
}
