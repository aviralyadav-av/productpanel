import { cache } from "react";
import { forbidden, redirect } from "next/navigation";
import { headers } from "next/headers";

import { auth } from "./index";
import { checkAdminSession, touchAdminSession } from "./session";
import { db } from "@/lib/db";
import { hasPermission, SUPER_ADMIN_ROLE_SLUG } from "@/lib/permissions";
import { getSettingBoolean } from "@/lib/settings";
import {
  forbiddenError,
  passwordChangeRequired,
  unauthorizedError,
} from "@/lib/api/errors";

/**
 * The resolved admin identity (blueprint §10, §14.D2, D10). `permissions` is
 * the flattened set from the user's role; `isSuperAdmin` short-circuits every
 * check.
 */
export type Actor = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  roleId: string | null;
  roleSlug: string | null;
  roleName: string | null;
  permissions: ReadonlySet<string>;
  isSuperAdmin: boolean;
  /** The AdminSession row behind this request. */
  sessionId: string;
  /** True while a 2FA challenge is outstanding on this session (D2). */
  pendingMfa: boolean;
  twoFactorEnabled: boolean;
  /** Set by an admin reset; the shell only allows /admin/account/password until cleared (D10). */
  forcePasswordChange: boolean;
};

export const LOGIN_PATH = "/admin/login";
export const TWO_FACTOR_PATH = "/admin/two-factor";
export const UNAUTHORIZED_PATH = "/admin/unauthorized";
export const PASSWORD_CHANGE_PATH = "/admin/account/password";
export const SECURITY_PATH = "/admin/account/security";
export const HOME_PATH = "/admin/dashboard";

/**
 * Returns the signed-in user, verified against the DATABASE.
 *
 * The JWT is a cache that can be hours stale. Every guard re-reads the user
 * row with its role and permissions, and the AdminSession row the token names,
 * so that deactivating an account, changing its role, editing a role's grants
 * or revoking a session takes effect on the next request instead of at token
 * expiry. Two indexed lookups per request is the right trade for a panel with
 * a few dozen operators.
 *
 * Wrapped in React's `cache()` so the layout, the page and the badge query of
 * one render share a single resolution instead of each re-reading the rows.
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;

  // A cookie without a session id predates AdminSession rows (or was forged);
  // either way there is nothing to revoke, so it is simply not a session.
  const sessionId = session.sessionId;
  if (!sessionId) return null;

  const [user, check] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        isActive: true,
        deletedAt: true,
        roleId: true,
        twoFactorEnabled: true,
        forcePasswordChange: true,
        role: {
          select: {
            slug: true,
            name: true,
            permissions: { select: { permission: { select: { code: true } } } },
          },
        },
      },
    }),
    checkAdminSession(sessionId, session.user.id),
  ]);

  if (!user || !user.isActive || user.deletedAt) return null;
  if (!check.ok) return null;

  await touchAdminSession(check.session);

  const permissions = new Set(
    user.role?.permissions.map((row) => row.permission.code) ?? [],
  );

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    roleId: user.roleId,
    roleSlug: user.role?.slug ?? null,
    roleName: user.role?.name ?? null,
    permissions,
    isSuperAdmin: user.role?.slug === SUPER_ADMIN_ROLE_SLUG,
    sessionId: check.session.id,
    // Session state, not user state: a user with 2FA who verified this device
    // is not pending, one who just signed in on a new device is (D2).
    pendingMfa: user.twoFactorEnabled && !check.session.mfaVerifiedAt,
    twoFactorEnabled: user.twoFactorEnabled,
    forcePasswordChange: user.forcePasswordChange,
  };
});

/** Permission test that honours the super-admin bypass. */
export function can(actor: Actor, code: string | readonly string[]): boolean {
  if (actor.isSuperAdmin) return true;
  return hasPermission(actor.permissions, code);
}

/**
 * Any active admin user with a role may enter the shell. Module access is then
 * decided per page by requirePermission(). proxy.ts performs a cheap optimistic
 * cookie check to keep signed-out users off the dashboard, but it is NOT
 * authorization - this is.
 */
export async function requireAdmin(): Promise<Actor> {
  const actor = await getActor();
  const path = await currentPath();

  if (!actor) {
    redirect(`${LOGIN_PATH}?callbackUrl=${encodeURIComponent(path)}`);
  }

  if (actor.pendingMfa) {
    redirect(`${TWO_FACTOR_PATH}?callbackUrl=${encodeURIComponent(path)}`);
  }

  if (!actor.roleSlug) {
    redirect(UNAUTHORIZED_PATH);
  }

  // The password page itself must stay reachable or the redirect would loop.
  if (actor.forcePasswordChange && !path.startsWith(PASSWORD_CHANGE_PATH)) {
    redirect(PASSWORD_CHANGE_PATH);
  }

  // Setting `security.require_2fa_for_super_admin`: a super-admin without
  // 2FA is walked to the enrolment page and nowhere else until it is on.
  // Cached setting read (60 s), so this costs nothing per request in practice.
  if (
    actor.isSuperAdmin &&
    !actor.twoFactorEnabled &&
    !path.startsWith(SECURITY_PATH) &&
    (await getSettingBoolean("security.require_2fa_for_super_admin"))
  ) {
    redirect(`${SECURITY_PATH}?required=1`);
  }

  return actor;
}

export type ThrowGuardOptions = {
  /** Only the 2FA challenge action itself may set this (D2). */
  allowPendingMfa?: boolean;
  /** Only the change-password action may set this (D10). */
  allowForcedPasswordChange?: boolean;
};

/**
 * The same check for contexts that must throw rather than redirect - Server
 * Actions and Route Handlers, where a 3xx would be swallowed or produce a
 * confusing client error. Throws `ApiError` (401/403) so `withAdminApi` maps
 * it to the envelope and `runAction` maps it to `fail()` (D10).
 */
export async function requireAdminOrThrow(options: ThrowGuardOptions = {}): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw unauthorizedError();
  if (actor.pendingMfa && !options.allowPendingMfa) {
    throw unauthorizedError("Complete two-factor verification to continue.");
  }
  if (!actor.roleSlug) throw forbiddenError("Your account has no role assigned.");
  if (actor.forcePasswordChange && !options.allowForcedPasswordChange) {
    throw passwordChangeRequired();
  }
  return actor;
}

/**
 * Page guard: signed-in admin holding the permission (or any of a list).
 * A missing permission renders app/admin/forbidden.tsx with a 403 inside the
 * shell (authInterrupts), so the operator keeps the sidebar and can go
 * somewhere they are allowed.
 */
export async function requirePermission(
  code: string | readonly string[],
): Promise<Actor> {
  const actor = await requireAdmin();
  if (!can(actor, code)) forbidden();
  return actor;
}

/** Action / API guard: 401 when signed out, 403 when lacking the permission. */
export async function requirePermissionOrThrow(
  code: string | readonly string[],
): Promise<Actor> {
  const actor = await requireAdminOrThrow();
  if (!can(actor, code)) throw forbiddenError();
  return actor;
}

/** The request path (with query) as recorded by proxy.ts, for callbackUrl. */
export async function currentPath(): Promise<string> {
  const headerList = await headers();
  return headerList.get("x-pathname") ?? headerList.get("x-invoke-path") ?? HOME_PATH;
}
