/**
 * One-time extractor: reads the storefront's static data modules and writes
 * JSON snapshots into prisma/seed/source/.
 *
 * Why snapshots instead of importing the sibling folder from the seeder:
 * admin_panel/ is its own deployable with its own build root. A relative import
 * reaching up into ../e-commerce_frontend-main/ would leave that root and fail
 * on any hosted build, and would couple two independently deployed projects at
 * build time. This script runs on a developer machine only.
 *
 * It READS the storefront and never writes to it.
 *
 *   npm run extract:storefront
 */
import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const STOREFRONT_ROOT = path.resolve(
  process.cwd(),
  "..",
  "e-commerce_frontend-main",
);

const STOREFRONT = path.join(STOREFRONT_ROOT, "src", "data");

const OUT_DIR = path.resolve(process.cwd(), "prisma", "seed", "source");

/**
 * Legacy assets live in the storefront's own public/ folder. They are copied
 * (not moved) into admin_panel/public/legacy/ so the admin renders real
 * thumbnails without the storefront dev server running, and so the media
 * library is usable offline.
 *
 * The database keeps the ORIGINAL storefront path as the canonical url, because
 * that is what the public API must return after cutover. The admin prefixes
 * "/legacy" only for its own previews - see resolveAssetUrl in src/lib/media.ts.
 */
const LEGACY_SOURCE = path.join(STOREFRONT_ROOT, "public", "products");
const LEGACY_DEST = path.resolve(process.cwd(), "public", "legacy", "products");

async function countFiles(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    total += entry.isDirectory()
      ? await countFiles(path.join(dir, entry.name))
      : 1;
  }
  return total;
}

async function copyLegacyAssets(): Promise<number> {
  await mkdir(path.dirname(LEGACY_DEST), { recursive: true });
  await cp(LEGACY_SOURCE, LEGACY_DEST, { recursive: true });
  return countFiles(LEGACY_DEST);
}

async function importData(file: string) {
  const url = pathToFileURL(path.join(STOREFRONT, file)).href;
  return import(url);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const products = await importData("products.js");
  const home = await importData("homeData.js");
  const footer = await importData("footerData.js");

  const snapshots: Record<string, unknown> = {
    "products.json": products.products,
    "home.json": {
      heroBanners: home.heroBannersData,
      announcements: home.announcementsData,
      promoBanners: home.promoBannersData,
      campaign: home.campaignData,
      craftsmanship: home.craftsmanshipData,
      reviews: home.reviewsData,
      reels: home.reelsData,
    },
    "footer.json": {
      footer: footer.footerData,
      pages: footer.footerPagesData,
    },
  };

  for (const [filename, value] of Object.entries(snapshots)) {
    if (value === undefined) {
      throw new Error(
        `Extraction failed: ${filename} resolved to undefined. The storefront data module may have been renamed.`,
      );
    }
    await writeFile(
      path.join(OUT_DIR, filename),
      JSON.stringify(value, null, 2) + "\n",
      "utf8",
    );
  }

  const productList = products.products as Array<Record<string, unknown>>;
  const variantCount = productList.reduce(
    (total, product) =>
      total + ((product.variants as unknown[] | undefined)?.length ?? 0),
    0,
  );

  const copiedAssets = await copyLegacyAssets();

  console.log(`Wrote snapshots to ${path.relative(process.cwd(), OUT_DIR)}`);
  console.log(
    `Copied ${copiedAssets} legacy assets to ${path.relative(process.cwd(), LEGACY_DEST)}`,
  );
  console.log(`  products      ${productList.length}`);
  console.log(`  variants      ${variantCount}`);
  console.log(`  hero banners  ${(home.heroBannersData as unknown[]).length}`);
  console.log(`  announcements ${(home.announcementsData as unknown[]).length}`);
  console.log(`  promo banners ${(home.promoBannersData as unknown[]).length}`);
  console.log(`  reels         ${(home.reelsData as unknown[]).length}`);
  console.log(`  testimonials  ${(home.reviewsData as unknown[]).length}`);
  console.log(
    `  cms pages     ${Object.keys(footer.footerPagesData as object).length}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
