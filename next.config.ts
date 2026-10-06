import type { NextConfig } from "next";

import { env } from "./src/lib/env";

/**
 * Next configuration (blueprint §14.D8, G6).
 *
 * `env` is imported rather than re-reading process.env so a missing or
 * malformed APP_ORIGIN fails here, at boot, with the same message the runtime
 * would give - not later, on the first cross-origin POST.
 */

const appHost = env.APP_HOST;

const s3PublicUrl = env.S3_PUBLIC_URL ? new URL(env.S3_PUBLIC_URL) : null;

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,

  // Native / Node-only packages must not be bundled by Turbopack (G6).
  serverExternalPackages: ["exceljs", "nodemailer", "sharp", "@aws-sdk/client-s3", "qrcode", "sanitize-html"],

  experimental: {
    // forbidden() / unauthorized() in guards + app/admin/{forbidden,unauthorized}.tsx (D10).
    authInterrupts: true,
    serverActions: {
      // Media uploads travel through Server Actions in the admin (D6).
      bodySizeLimit: "20mb",
      // Same-origin is always allowed; this covers a reverse proxy whose Host
      // differs from the public origin.
      allowedOrigins: [appHost],
    },
  },

  images: {
    remotePatterns: s3PublicUrl
      ? [
          {
            protocol: s3PublicUrl.protocol === "http:" ? "http" : "https",
            hostname: s3PublicUrl.hostname,
            port: s3PublicUrl.port || undefined,
            pathname: "/**",
          },
        ]
      : [],
  },

  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      {
        // The admin shell must never be framed (clickjacking); public
        // /media and /api/v1 stay embeddable by the storefront.
        source: "/admin/:path*",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
    ];
  },
};

export default nextConfig;
