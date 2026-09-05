import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Prisma 7 requires a driver adapter at the client constructor; the connection
 * URL for the CLI lives in prisma.config.ts.
 *
 * On a serverless host, put a pooled connection string in DATABASE_URL
 * (PgBouncer / Neon / Supabase pooler) and keep the direct one in
 * DIRECT_DATABASE_URL for migrations - functions open too many short-lived
 * connections for an unpooled Postgres to survive.
 */
function createClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and re-run.",
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log:
      process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// The Next dev server hot-reloads modules on every edit. Without this the
// process accumulates one connection pool per reload until Postgres refuses
// new connections.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
