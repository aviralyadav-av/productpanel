import type { NextAuthConfig } from "next-auth";

/**
 * The base Auth.js config. Deliberately free of Prisma and bcrypt so it can be
 * imported by proxy.ts without dragging the database driver into the request
 * path on every navigation.
 *
 * The Credentials provider - the only part that needs the database - is added
 * in ./index.ts, which is what the route handler and server code import.
 */
export const authConfig = {
  // A Credentials provider cannot use database sessions in Auth.js, so the
  // session is a signed JWT. That makes the token a CACHE of the role, not the
  // source of truth: requireAdmin() re-reads the user row on every mutation so
  // a demoted or deactivated admin loses access immediately rather than at
  // token expiry.
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 8, // 8 hours - one working day, then re-authenticate
    updateAge: 60 * 15,
  },

  pages: {
    signIn: "/login",
    error: "/login",
  },

  trustHost: true,

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role?: string }).role ?? "USER";
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = (token.role as string) ?? "USER";
      }
      return session;
    },
  },

  providers: [],
} satisfies NextAuthConfig;
