/**
 * Seed orchestrator (blueprint §12, §14.G1).
 *
 * Wave 1 seeds the platform's reference data only: permissions, roles and
 * users; settings; the category taxonomy and attribute sets; commission rules;
 * email templates; navigation menus; system CMS pages and the footer; payment
 * providers, shipping partners and the default shipping zone.
 *
 * No demo sellers, products, customers or orders live here - that dataset is
 * wave 2b (`prisma/seed/modules/*` guarded by SEED_DEMO_DATA).
 *
 * Re-runnable: every module upserts on a stable key and never overwrites values
 * an admin may have edited (see each module's doc comment).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import type { SeedContext, SeedModule } from "./seed/modules/context";
import { seedAccess } from "./seed/modules/access";
import { seedSettings } from "./seed/modules/settings";
import { seedTaxonomy } from "./seed/modules/taxonomy";
import { seedAttributes } from "./seed/modules/attributes";
import { seedCommissions } from "./seed/modules/commissions";
import { seedTemplates } from "./seed/modules/templates";
import { seedPages } from "./seed/modules/pages";
import { seedMenus } from "./seed/modules/menus";
import { seedPayments } from "./seed/modules/payments";
import { seedDemoMedia } from "./seed/modules/demo-media";
import { seedDemoSellers } from "./seed/modules/demo-sellers";
import { seedDemoProducts } from "./seed/modules/demo-products";
import { seedDemoCustomers } from "./seed/modules/demo-customers";
import { seedDemoMarketing } from "./seed/modules/demo-marketing";
import { seedDemoOrders } from "./seed/modules/demo-orders";
import { seedDemoReturns } from "./seed/modules/demo-returns";
import { seedDemoStock } from "./seed/modules/demo-stock";
import { seedDemoContent } from "./seed/modules/demo-content";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and re-run.");
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const ctx: SeedContext = {
  adminEmail: (process.env.SEED_ADMIN_EMAIL ?? "admin@diybaazar.local").toLowerCase().trim(),
  adminPassword: process.env.SEED_ADMIN_PASSWORD ?? "Admin@123456",
  systemUserId: "system",
  adminUserId: null,
  demo: (process.env.SEED_DEMO_DATA ?? "true") !== "false",
  log: (message) => console.log(`  ${message}`),
};

// Order matters: pages before menus (menu items point at pages), taxonomy
// before attributes and commissions (assignments point at categories).
const MODULES: Array<[string, SeedModule]> = [
  ["access", seedAccess],
  ["settings", seedSettings],
  ["taxonomy", seedTaxonomy],
  ["attributes", seedAttributes],
  ["commissions", seedCommissions],
  ["templates", seedTemplates],
  ["pages", seedPages],
  ["menus", seedMenus],
  ["payments", seedPayments],
];

// Wave 2b demo dataset (blueprint §12, G3). Every demo row id starts with
// "demo_"; the whole block is skipped when SEED_DEMO_DATA=false. Order matters:
// media before sellers/products (artwork), products + customers + marketing
// before orders, orders before returns/ledger, stock movements after both (they
// are derived from the persisted orders and returns and applied in time order),
// everything before content (reviews reference delivered order items).
const DEMO_MODULES: Array<[string, SeedModule]> = [
  ["demo:media", seedDemoMedia],
  ["demo:sellers", seedDemoSellers],
  ["demo:products", seedDemoProducts],
  ["demo:customers", seedDemoCustomers],
  ["demo:marketing", seedDemoMarketing],
  ["demo:orders", seedDemoOrders],
  ["demo:returns", seedDemoReturns],
  ["demo:stock", seedDemoStock],
  ["demo:content", seedDemoContent],
];

async function main() {
  const startedAt = Date.now();
  for (const [name, run] of MODULES) {
    console.log(`▸ ${name}`);
    await run(db, ctx);
  }
  if (ctx.demo) {
    for (const [name, run] of DEMO_MODULES) {
      const moduleStartedAt = Date.now();
      console.log(`▸ ${name}`);
      await run(db, ctx);
      console.log(`  (${((Date.now() - moduleStartedAt) / 1000).toFixed(1)}s)`);
    }
  } else {
    console.log("▸ demo data skipped (SEED_DEMO_DATA=false)");
  }
  console.log(`Seed complete in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
  console.log(`Sign in as ${ctx.adminEmail} with the SEED_ADMIN_PASSWORD from .env.`);
}

main()
  .catch((error) => {
    console.error("SEED FAILED", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    // The finance/inventory services hold their own client (src/lib/db.ts);
    // markEarningsAvailable connects it, so close it or the process lingers.
    const { db: serviceDb } = await import("@/lib/db");
    await serviceDb.$disconnect();
  });
