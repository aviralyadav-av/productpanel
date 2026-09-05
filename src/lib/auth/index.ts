import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "@/lib/db";
import { authConfig } from "./config";

export const credentialsSchema = z.object({
  email: z.email({ message: "Enter a valid email address." }),
  password: z.string().min(1, { message: "Enter your password." }),
});

/** Lock an email out after this many failed attempts inside the window. */
const MAX_ATTEMPTS = 8;
const WINDOW_MINUTES = 15;

async function isLockedOut(email: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);
  const failures = await db.loginAttempt.count({
    where: { email, success: false, createdAt: { gte: since } },
  });
  return failures >= MAX_ATTEMPTS;
}

async function recordAttempt(email: string, success: boolean) {
  await db.loginAttempt.create({ data: { email, success } });
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },

      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const email = parsed.data.email.toLowerCase().trim();

        // Rate limiting lives in the database rather than Redis: this store
        // has a handful of admin logins a day, so a counting query is cheaper
        // and simpler than an extra piece of infrastructure.
        if (await isLockedOut(email)) return null;

        const user = await db.user.findUnique({ where: { email } });

        // Compare against a dummy hash when the user does not exist so the
        // response time does not reveal which emails are registered.
        const hash =
          user?.passwordHash ??
          "$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        const valid = await bcrypt.compare(parsed.data.password, hash);

        if (!user || !valid || !user.isActive) {
          await recordAttempt(email, false);
          return null;
        }

        await recordAttempt(email, true);
        await db.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        // Note: a USER-role account authenticates successfully here. It is the
        // authorization layer, not this function, that refuses it the admin
        // area - so the operator can tell "wrong password" from "not an admin".
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
        };
      },
    }),
  ],
});
