import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { authConfig } from "@/lib/auth/config";

/**
 * Next.js 16 renamed `middleware` to `proxy`. It runs on the Node.js runtime.
 *
 * This is an OPTIMISTIC check only: it reads the signed session cookie and
 * keeps signed-out visitors off the dashboard so they get a login screen
 * instead of a flash of empty layout. It deliberately does not touch the
 * database and is NOT the authorization boundary - requireAdmin() in
 * src/lib/auth/guards.ts is, and it runs again inside every protected layout,
 * Server Action and Route Handler.
 */
const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = ["/login", "/unauthorized"];

export const proxy = auth((req) => {
  const { pathname, search } = req.nextUrl;

  // The public storefront read API must stay reachable without a session -
  // it is what the Vite storefront will call after cutover. Without this
  // branch the catch-all matcher below would redirect it to /login.
  if (pathname.startsWith("/api/v1")) {
    return NextResponse.next();
  }

  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  const isSignedIn = Boolean(req.auth?.user);

  if (isSignedIn && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  if (!isSignedIn && !isPublic) {
    const loginUrl = new URL("/login", req.nextUrl);
    loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  // Expose the path so server guards can build an accurate callbackUrl.
  const headers = new Headers(req.headers);
  headers.set("x-pathname", `${pathname}${search}`);
  return NextResponse.next({ request: { headers } });
});

export const config = {
  // Default-deny. Everything is protected except Next internals, static files
  // and the Auth.js endpoints themselves.
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|mp4|webm)$).*)",
  ],
};
