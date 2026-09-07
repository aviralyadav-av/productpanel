import { forbidden, redirect, unauthorized } from "next/navigation";
import { headers } from "next/headers";

import { auth } from "./index";
import { db } from "@/lib/db";
import type { Role } from "@/lib/enums";

export type Actor = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: Role;
};

/**
 * Returns the signed-in user, verified against the DATABASE.
 *
 * The JWT carries a role claim, but it is a cache that can be up to eight
 * hours stale. Every guard re-reads the user row so that deactivating an
 * account or demoting an admin takes effect on the next request instead of at
 * token expiry. For a panel with two or three operators this costs one indexed
 * primary-key lookup per request, which is the right trade.
 */
export async function getActor(): Promise<Actor | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      role: true,
      isActive: true,
    },
  });

  if (!user || !user.isActive) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    role: user.role as Role,
  };
}

/**
 * The single gate every admin page, Server Action and admin Route Handler goes
 * through. proxy.ts performs a cheap optimistic check to keep signed-out users
 * off the dashboard, but it is NOT authorization - this is.
 */
export async function requireAdmin(): Promise<Actor> {
  const actor = await getActor();

  if (!actor) {
    const path = await currentPath();
    redirect(`/login?callbackUrl=${encodeURIComponent(path)}`);
  }

  if (actor.role !== "ADMIN") {
    redirect("/unauthorized");
  }

  return actor;
}

/**
 * The same check for contexts that must throw rather than redirect - Server
 * Actions and Route Handlers, where a 3xx would be swallowed or produce a
 * confusing client error.
 */
export async function requireAdminOrThrow(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) unauthorized();
  if (actor.role !== "ADMIN") forbidden();
  return actor;
}

async function currentPath(): Promise<string> {
  const headerList = await headers();
  return (
    headerList.get("x-pathname") ??
    headerList.get("x-invoke-path") ??
    "/dashboard"
  );
}
