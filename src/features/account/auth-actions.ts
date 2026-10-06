"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";

import { auth, signIn, signOut, credentialsSchema } from "@/lib/auth";
import { recordAuthAudit } from "@/lib/auth/audit";
import { LOGIN_PATH } from "@/lib/auth/guards";
import { revokeAdminSession } from "@/lib/auth/session";
import { clientIp } from "@/lib/client-ip";
import { safeCallbackPath } from "./redirects";

export type LoginState = {
  error?: string;
  fieldErrors?: Partial<Record<"email" | "password", string>>;
};

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const fieldErrors: LoginState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === "email" || key === "password") {
        fieldErrors[key] ??= issue.message;
      }
    }
    return { fieldErrors };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: safeCallbackPath(formData.get("callbackUrl")),
    });
  } catch (error) {
    // A successful sign-in throws a redirect, which is not an AuthError and
    // must be rethrown for Next.js to act on it.
    if (error instanceof AuthError) {
      return {
        error:
          error.type === "CredentialsSignin"
            ? "Those details did not match an active account, or too many attempts were made. Wait a moment and try again."
            : "Could not sign you in. Please try again.",
      };
    }
    throw error;
  }

  return {};
}

/**
 * Explicit sign-out: revoke the AdminSession row FIRST (D10 "sign-out deletes
 * the row") and audit it (D13), then clear the cookie. The Auth.js signOut
 * event revokes again as a backstop for the /api/auth/signout path.
 */
export async function signOutAction() {
  const session = await auth();
  const headerList = await headers();

  if (session?.user?.id) {
    const sessionId = session.sessionId ?? null;
    if (sessionId) await revokeAdminSession(sessionId).catch(() => false);
    await recordAuthAudit({
      userId: session.user.id,
      email: session.user.email ?? "",
      action: "auth.logout",
      summary: `${session.user.email ?? session.user.id} signed out`,
      entityType: "admin_session",
      entityId: sessionId,
      ip: clientIp(headerList),
      userAgent: headerList.get("user-agent"),
    });
  }

  await signOut({ redirectTo: LOGIN_PATH });
}
