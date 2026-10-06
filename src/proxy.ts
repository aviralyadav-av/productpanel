import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";

import { authConfig } from "@/lib/auth/config";

/**
 * Next.js 16 renamed `middleware` to `proxy`. It runs on the Node.js runtime.
 *
 * This is an OPTIMISTIC check only: it reads the signed session cookie and
 * keeps signed-out visitors off the admin so they get a login screen instead
 * of a flash of empty layout. It deliberately does not touch the database and
 * is NOT the authorization boundary - requireAdmin() in src/lib/auth/guards.ts
 * is, and it runs again inside every protected layout, Server Action and
 * Route Handler with the user and AdminSession rows re-read.
 *
 * Default-deny: everything is protected unless listed here (blueprint §14.D2,
 * D10). The public storefront API (/api/v1), webhooks/cron (/api/internal),
 * served media (/media) and Auth.js itself (/api/auth) are excluded in the
 * matcher so they never pay for a cookie parse.
 */
const { auth } = NextAuth(authConfig);

const LOGIN_PATH = "/admin/login";
const HOME_PATH = "/admin/dashboard";
const TWO_FACTOR_PATH = "/admin/two-factor";

/** Reachable without a session. Prefix match on the path. */
const PUBLIC_PREFIXES = [
  "/admin/login",
  "/admin/forgot-password",
  "/admin/reset-password",
  "/admin/unauthorized",
];

/** Belt-and-braces for paths the matcher should already exclude. */
const BYPASS_PREFIXES = ["/api/auth", "/api/v1", "/api/internal", "/media"];

function startsWithAny(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

/** API callers get a JSON 401 in the standard envelope, never an HTML redirect. */
function apiUnauthorized(message: string): NextResponse {
  return NextResponse.json(
    { error: { code: "UNAUTHORIZED", message } },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

function withPathHeader(req: NextRequest): NextResponse {
  // Expose the path so server guards can build an accurate callbackUrl.
  const headers = new Headers(req.headers);
  headers.set("x-pathname", `${req.nextUrl.pathname}${req.nextUrl.search}`);
  return NextResponse.next({ request: { headers } });
}

export const proxy = auth((req) => {
  const { pathname, search } = req.nextUrl;

  if (startsWithAny(pathname, BYPASS_PREFIXES)) return NextResponse.next();

  const isSignedIn = Boolean(req.auth?.user?.id && req.auth?.sessionId);
  const pendingMfa = isSignedIn && Boolean(req.auth?.pendingMfa);
  const isPublic = startsWithAny(pathname, PUBLIC_PREFIXES);

  // The bare roots always land on the dashboard (signed out → login below).
  if (pathname === "/" || pathname === "/admin") {
    return NextResponse.redirect(new URL(isSignedIn ? HOME_PATH : LOGIN_PATH, req.nextUrl));
  }

  // A signed-in, verified user has no business on the login page.
  if (isSignedIn && !pendingMfa && pathname === LOGIN_PATH) {
    return NextResponse.redirect(new URL(HOME_PATH, req.nextUrl));
  }

  // The 2FA challenge needs a session but is the ONLY page a pending one may see.
  if (pathname === TWO_FACTOR_PATH || pathname.startsWith(`${TWO_FACTOR_PATH}/`)) {
    if (!isSignedIn) {
      return NextResponse.redirect(new URL(`${LOGIN_PATH}?reason=session_ended`, req.nextUrl));
    }
    return withPathHeader(req);
  }

  if (pendingMfa && !isPublic) {
    if (isApiPath(pathname)) {
      return apiUnauthorized("Complete two-factor verification to continue.");
    }
    const challengeUrl = new URL(TWO_FACTOR_PATH, req.nextUrl);
    challengeUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(challengeUrl);
  }

  if (!isSignedIn && !isPublic) {
    if (isApiPath(pathname)) return apiUnauthorized("Sign in to continue.");
    const loginUrl = new URL(LOGIN_PATH, req.nextUrl);
    loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return withPathHeader(req);
});

export const config = {
  // Default-deny. Everything runs through the proxy except Next internals,
  // static files, the Auth.js endpoints, the public API, cron/webhooks and
  // served media (storefront visitors are anonymous).
  matcher: [
    "/((?!api/auth|api/v1|api/internal|media/|_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|mp4|webm|woff2?|ttf|txt|xml)$).*)",
  ],
};
