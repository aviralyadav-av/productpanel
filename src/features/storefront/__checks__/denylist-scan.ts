/**
 * D11 denylist scan for the public read API (blueprint §14.D11, G7).
 *
 * Calls the storefront query functions DIRECTLY (no HTTP, no cache) and walks
 * every key of every JSON body looking for the fields that must never leave
 * the server: costPaise, passwordHash, email, phone, pan, gstin,
 * accountNumber, *Enc, *Hash, ipAddress, userAgent, rawPayload, isInternal,
 * draftPayload, commissionPaise, sellerPayablePaise, notes, customerId.
 * Exact key match, plus the two suffix patterns; `store.contact_email` (a
 * public setting key) is therefore fine while a bare `email` is not.
 *
 * Also asserts the responses are pure JSON (no Date, no undefined, no
 * functions) so a cached copy is byte-identical to a fresh one.
 *
 * Run from the repo root (needs DATABASE_URL; the stub preload
 * neutralises the `server-only` marker behind lib/settings):
 *
 *   node --env-file=.env --import tsx --import ./src/features/storefront/__checks__/stub-server-only.ts src/features/storefront/__checks__/denylist-scan.ts
 *
 * Exit code 1 on any finding.
 */

import { db } from "@/lib/db";
import { getBanners } from "@/features/storefront/queries/banners";
import { listBlogPosts, getBlogPost, parseBlogListQuery } from "@/features/storefront/queries/blog";
import { getCategoryPage, getCategoryTree } from "@/features/storefront/queries/categories";
import { getFaqGroups } from "@/features/storefront/queries/faqs";
import { getFooter } from "@/features/storefront/queries/footer";
import { getHome } from "@/features/storefront/queries/home";
import { getMenu } from "@/features/storefront/queries/navigation";
import { getPage } from "@/features/storefront/queries/pages";
import {
  getProductDetail,
  listProductReviews,
  listProducts,
  parseProductListQuery,
} from "@/features/storefront/queries/products";
import { getSellerPage } from "@/features/storefront/queries/sellers";
import { getPublicSettingsPayload } from "@/features/storefront/queries/settings";
import { getSitemap } from "@/features/storefront/queries/sitemap";
import { ELIGIBLE_PRODUCT_WHERE } from "@/features/storefront/queries/shared";

const EXACT_DENYLIST = [
  "costPaise",
  "passwordHash",
  "email",
  "phone",
  "pan",
  "gstin",
  "accountNumber",
  "ipAddress",
  "userAgent",
  "rawPayload",
  "isInternal",
  "draftPayload",
  "commissionPaise",
  "sellerPayablePaise",
  "notes",
  "customerId",
] as const;
const SUFFIX_DENYLIST = ["Enc", "Hash"] as const;

type Finding = { endpoint: string; path: string; reason: string };

function isDenied(key: string): string | null {
  if ((EXACT_DENYLIST as readonly string[]).includes(key)) return `denylisted key "${key}"`;
  for (const suffix of SUFFIX_DENYLIST) {
    if (key.length > suffix.length && key.endsWith(suffix)) return `key "${key}" ends with "${suffix}"`;
  }
  return null;
}

function scan(endpoint: string, value: unknown, path: string, findings: Finding[]): void {
  if (value === undefined) {
    findings.push({ endpoint, path, reason: "undefined is not JSON (becomes a missing key after caching)" });
    return;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) findings.push({ endpoint, path, reason: `non-finite number ${value}` });
    return;
  }
  if (typeof value === "function" || typeof value === "bigint" || typeof value === "symbol") {
    findings.push({ endpoint, path, reason: `${typeof value} is not JSON` });
    return;
  }
  if (value instanceof Date) {
    findings.push({ endpoint, path, reason: "Date object (serialise to ISO string)" });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scan(endpoint, item, `${path}[${index}]`, findings));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const denied = isDenied(key);
    if (denied) findings.push({ endpoint, path: `${path}.${key}`, reason: denied });
    scan(endpoint, child, `${path}.${key}`, findings);
  }
}

async function pickSamples() {
  const [product, category, seller, page, post, menu] = await Promise.all([
    db.product.findFirst({ where: ELIGIBLE_PRODUCT_WHERE, select: { slug: true }, orderBy: { createdAt: "asc" } }),
    db.category.findFirst({ where: { isActive: true, depth: { gt: 0 } }, select: { slug: true } }),
    db.seller.findFirst({ where: { status: "ACTIVE", deletedAt: null }, select: { slug: true } }),
    db.cmsPage.findFirst({ where: { status: "PUBLISHED" }, select: { slug: true } }),
    db.blogPost.findFirst({ where: { status: "PUBLISHED" }, select: { slug: true } }),
    db.navigationMenu.findFirst({ where: { slug: "main" }, select: { slug: true } }),
  ]);
  return {
    productSlug: product?.slug ?? null,
    categorySlug: category?.slug ?? null,
    sellerSlug: seller?.slug ?? null,
    pageSlug: page?.slug ?? null,
    postSlug: post?.slug ?? null,
    menuSlug: menu?.slug ?? "main",
  };
}

async function main(): Promise<void> {
  const samples = await pickSamples();
  const findings: Finding[] = [];
  const summary: Array<{ endpoint: string; keys: number; note?: string }> = [];

  const run = async (endpoint: string, fn: () => Promise<unknown>, note?: string) => {
    let body: unknown;
    try {
      body = await fn();
    } catch (error) {
      findings.push({ endpoint, path: "$", reason: `threw: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    scan(endpoint, body, "$", findings);
    summary.push({ endpoint, keys: JSON.stringify(body ?? null).length, note });
  };

  await run("GET /categories", () => getCategoryTree());
  if (samples.categorySlug) {
    await run(`GET /categories/${samples.categorySlug}`, () => getCategoryPage(samples.categorySlug as string));
  } else summary.push({ endpoint: "GET /categories/:slug", keys: 0, note: "skipped - no active category" });

  await run("GET /products?include=facets,category", () =>
    listProducts(
      parseProductListQuery(
        new URLSearchParams(
          samples.categorySlug ? `include=facets,category&category=${samples.categorySlug}` : "include=facets",
        ),
      ),
    ),
  );
  await run("GET /products?q=&sort=price_asc&attr[color]=red", () =>
    listProducts(parseProductListQuery(new URLSearchParams("q=a&sort=price_asc&attr[color]=red&minPrice=0&maxPrice=100000"))),
  );

  if (samples.productSlug) {
    await run(`GET /products/${samples.productSlug}`, () => getProductDetail(samples.productSlug as string));
    await run(`GET /products/${samples.productSlug}/reviews`, () =>
      listProductReviews(samples.productSlug as string, { page: 1, pageSize: 10 }),
    );
  } else {
    summary.push({ endpoint: "GET /products/:slug", keys: 0, note: "skipped - no eligible product yet (seed in progress)" });
  }

  await run("GET /home", () => getHome());
  await run("GET /banners", () => getBanners({}));
  await run(`GET /navigation/${samples.menuSlug}`, () => getMenu(samples.menuSlug));
  if (samples.pageSlug) await run(`GET /pages/${samples.pageSlug}`, () => getPage(samples.pageSlug as string));
  await run("GET /faqs", () => getFaqGroups());
  await run("GET /footer", () => getFooter());
  await run("GET /settings", () => getPublicSettingsPayload());
  await run("GET /blog", () => listBlogPosts(parseBlogListQuery(new URLSearchParams(""))));
  if (samples.postSlug) await run(`GET /blog/${samples.postSlug}`, () => getBlogPost(samples.postSlug as string));
  if (samples.sellerSlug) {
    await run(`GET /sellers/${samples.sellerSlug}`, () =>
      getSellerPage(samples.sellerSlug as string, { page: 1, pageSize: 24, sort: "position" }),
    );
  } else summary.push({ endpoint: "GET /sellers/:slug", keys: 0, note: "skipped - no ACTIVE seller" });
  await run("GET /seo/sitemap", () => getSitemap());

  for (const row of summary) {
    console.log(`${row.note ? "SKIP" : " ok "} ${row.endpoint.padEnd(52)} ${row.note ?? `${row.keys} bytes`}`);
  }

  if (findings.length > 0) {
    console.error(`\nDENYLIST SCAN FAILED: ${findings.length} finding(s)`);
    for (const finding of findings) console.error(`  ${finding.endpoint}  ${finding.path}  ${finding.reason}`);
    process.exitCode = 1;
  } else {
    console.log(`\nDENYLIST SCAN PASSED: ${summary.filter((row) => !row.note).length} responses scanned, 0 findings`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
