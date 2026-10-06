import { db } from "@/lib/db";
import { listUserSessions, type OwnSessionRow } from "@/lib/auth/session";

/**
 * Read models for the /admin/account pages. Everything here is scoped to the
 * signed-in user's own row; the users module (wave 3) owns cross-user reads.
 */

export type AccountProfile = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  image: string | null;
  roleName: string | null;
  twoFactorEnabled: boolean;
  forcePasswordChange: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

export async function getAccountProfile(userId: string): Promise<AccountProfile | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      image: true,
      twoFactorEnabled: true,
      forcePasswordChange: true,
      lastLoginAt: true,
      createdAt: true,
      role: { select: { name: true } },
    },
  });
  if (!user) return null;
  const { role, ...rest } = user;
  return { ...rest, roleName: role?.name ?? null };
}

export type RecentSignIn = {
  id: string;
  success: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
};

/** The user's own recent sign-in attempts (successes and failures). */
export async function getRecentSignIns(email: string, take = 10): Promise<RecentSignIn[]> {
  return db.loginAttempt.findMany({
    where: { email },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, success: true, ip: true, userAgent: true, createdAt: true },
  });
}

export async function getOwnSessions(
  userId: string,
  currentSessionId: string | null,
): Promise<OwnSessionRow[]> {
  return listUserSessions(userId, currentSessionId);
}
