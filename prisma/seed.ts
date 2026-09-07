/**
 * Seeds the admin database from the storefront snapshots in prisma/seed/source/.
 *
 * WHAT IS REAL AND WHAT IS NOT
 *   Real   - all 39 products, 78 variants, 39 images, categories, every
 *            homepage section, all 8 CMS pages, the 6 FAQs, the footer, and the
 *            3 homepage testimonials. Extracted verbatim from the storefront.
 *   Chosen - opening stock. The storefront has no inventory data at all, so the
 *            seeder records an explicit opening-balance ledger entry per
 *            variant. Change it with SEED_OPENING_STOCK.
 *   Demo   - customers and orders. The storefront writes orders to the
 *            shopper's own localStorage and never transmits them, so there is
 *            no order history to import. These exist only so the dashboard has
 *            something to render. Controlled by SEED_DEMO_ORDERS, and the app
 *            shows a "sample data" banner while any of them exist.
 *
 * Re-runnable: every write is an upsert keyed on a stable id.
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const SOURCE = path.resolve(process.cwd(), "prisma", "seed", "source");
const OPENING_STOCK = Number(process.env.SEED_OPENING_STOCK ?? 12);
const SEED_DEMO = (process.env.SEED_DEMO_ORDERS ?? "true") !== "false";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@niyabags.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin@12345";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic PRNG so re-seeding produces identical demo data. */
function mulberry32(seed: number) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260904);

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

async function readSnapshot<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(path.join(SOURCE, file), "utf8")) as T;
}

function daysAgo(days: number, hour = 11): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, randInt(0, 59), 0, 0);
  return date;
}

// ---------------------------------------------------------------------------
// Snapshot types (the legacy shapes, exactly as they exist on disk)
// ---------------------------------------------------------------------------

type LegacyVariant = { id?: string; name: string; images: string[] };

type LegacyProduct = {
  id: string;
  slug: string;
  title: string;
  gender: string;
  category: string;
  subcategory: string;
  price: number;
  description: string;
  isOnSale: boolean;
  salePrice: number | null;
  discountPercentage: number;
  orderCount: number;
  rating: number;
  reviewCount: number;
  createdAt: string;
  isFeatured: boolean;
  variants: LegacyVariant[];
};

type LegacyHome = {
  heroBanners: Array<{
    id: string;
    image: string;
    title: string;
    subtitle: string;
    buttonText: string;
    buttonLink: string;
  }>;
  announcements: Array<{ id: number; text: string }>;
  promoBanners: Array<{
    id: string;
    page: string;
    position: string;
    image: string;
    title: string;
    alt: string;
    isActive: boolean;
  }>;
  campaign: Record<string, unknown>;
  craftsmanship: Record<string, unknown>;
  reviews: Array<{ name: string; location: string; text: string }>;
  reels: Array<{
    id: number;
    video: string;
    title: string;
    isActive: boolean;
  }>;
};

type LegacyFooter = {
  footer: {
    brand: { name: string; description: string };
    socialLinks: Array<{ id: number; platform: string; url: string }>;
    sections: Array<{
      id: number;
      title: string;
      links: Array<{ id: number; label: string; path: string }>;
    }>;
    customerService: { heading: string; description: string; email: string };
    legalLinks: Array<{ id: number; label: string; path: string }>;
    copyright: string;
  };
  pages: Record<string, Record<string, unknown>>;
};

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

const mediaIdByUrl = new Map<string, string>();

async function ensureMedia(
  url: string,
  folder: string,
  alt?: string,
): Promise<string> {
  const existing = mediaIdByUrl.get(url);
  if (existing) return existing;

  const isExternal = /^https?:\/\//i.test(url);
  const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(url) || url.includes("/video/");
  const filename = decodeURIComponent(url.split("/").pop() ?? url).split("?")[0];

  const record = await db.mediaAsset.upsert({
    where: { url },
    update: {},
    create: {
      url,
      filename,
      kind: isVideo ? "video" : "image",
      folder,
      alt: alt ?? null,
      // Legacy assets live in the storefront's own /public folder. They are
      // referenced by path, not hosted by the admin, until they are re-uploaded.
      source: isExternal ? "external" : "legacy",
    },
  });

  mediaIdByUrl.set(url, record.id);
  return record.id;
}

// ---------------------------------------------------------------------------
// Seed steps
// ---------------------------------------------------------------------------

async function seedUsers() {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  const admin = await db.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { role: "ADMIN", isActive: true },
    create: {
      email: ADMIN_EMAIL,
      name: "Niya Admin",
      passwordHash,
      role: "ADMIN",
    },
  });

  // A USER-role account exists so the authorization boundary can actually be
  // tested: this account can sign in and must then be refused the dashboard.
  await db.user.upsert({
    where: { email: "customer@example.com" },
    update: { role: "USER" },
    create: {
      email: "customer@example.com",
      name: "Test Customer",
      passwordHash: await bcrypt.hash("Customer@12345", 12),
      role: "USER",
    },
  });

  return admin;
}

const SETTINGS: Array<{
  key: string;
  value: string;
  type: string;
  group: string;
  label: string;
  helpText?: string;
}> = [
  { key: "store.name", value: "Niya Bags", type: "string", group: "general", label: "Store name" },
  { key: "store.email", value: "support@niyabags.com", type: "string", group: "general", label: "Support email" },
  { key: "store.phone", value: "", type: "string", group: "general", label: "Support phone" },
  { key: "store.currency", value: "INR", type: "string", group: "general", label: "Currency", helpText: "All amounts are stored in paise and displayed in rupees." },
  { key: "store.timezone", value: "Asia/Kolkata", type: "string", group: "general", label: "Timezone", helpText: "Analytics day boundaries are computed in this timezone." },
  {
    key: "shipping.freeThresholdPaise",
    value: "200000",
    type: "money",
    group: "shipping",
    label: "Free shipping above",
    helpText:
      "The storefront hardcodes this rule in OrderPage.jsx (>= Rs 2,000). Changing it here has no effect until the storefront reads shipping from the API. Note the homepage trust badge advertises Rs 10,000 and CartPage shows Rs 0 shipping unconditionally - three sources currently disagree.",
  },
  { key: "shipping.flatRatePaise", value: "10000", type: "money", group: "shipping", label: "Flat shipping rate" },
  { key: "inventory.defaultLowStockThreshold", value: "3", type: "number", group: "inventory", label: "Default low-stock threshold" },
  { key: "alerts.pendingOrderHours", value: "24", type: "number", group: "alerts", label: "Flag orders pending longer than (hours)" },
  { key: "seo.defaultTitle", value: "Niya Bags - Modern luxury handbags", type: "string", group: "seo", label: "Default meta title" },
  { key: "seo.defaultDescription", value: "Modern luxury handbags thoughtfully designed and handcrafted.", type: "string", group: "seo", label: "Default meta description" },
  { key: "social.instagram", value: "", type: "string", group: "social", label: "Instagram URL" },
  { key: "social.facebook", value: "", type: "string", group: "social", label: "Facebook URL" },
  { key: "social.youtube", value: "", type: "string", group: "social", label: "YouTube URL" },
];

async function seedSettings() {
  for (const setting of SETTINGS) {
    await db.setting.upsert({
      where: { key: setting.key },
      update: { label: setting.label, type: setting.type, group: setting.group, helpText: setting.helpText ?? null },
      create: { ...setting, helpText: setting.helpText ?? null },
    });
  }
}

async function seedCatalog(products: LegacyProduct[]) {
  // ---- Categories -------------------------------------------------------
  // Two levels: legacy `category` ("bags") is the parent, legacy `subcategory`
  // is the child. `gender` stays a product field because the storefront filters
  // on product.gender and derives its facets from it.
  const parentSlugs = [...new Set(products.map((p) => p.category))];
  const parentIdBySlug = new Map<string, string>();

  for (const [index, slug] of parentSlugs.entries()) {
    const category = await db.category.upsert({
      where: { slug },
      update: {},
      create: {
        slug,
        name: titleCase(slug),
        position: index,
        isActive: true,
      },
    });
    parentIdBySlug.set(slug, category.id);
  }

  const childKeys = [
    ...new Set(products.map((p) => `${p.category}::${p.subcategory}`)),
  ];
  const categoryIdBySub = new Map<string, string>();

  for (const [index, key] of childKeys.entries()) {
    const [parentSlug, sub] = key.split("::");
    const category = await db.category.upsert({
      where: { slug: sub },
      update: { parentId: parentIdBySlug.get(parentSlug) },
      create: {
        slug: sub,
        name: titleCase(sub),
        parentId: parentIdBySlug.get(parentSlug),
        position: index,
        isActive: true,
      },
    });
    categoryIdBySub.set(sub, category.id);
  }

  // ---- Products, variants, images, inventory ----------------------------
  let variantCount = 0;
  let imageCount = 0;
  let collapsedDuplicates = 0;

  for (const [index, legacy] of products.entries()) {
    const product = await db.product.upsert({
      where: { id: legacy.id },
      update: {},
      create: {
        id: legacy.id,
        slug: legacy.slug,
        title: legacy.title,
        description: legacy.description ?? "",
        gender: legacy.gender ?? "women",
        categoryId: categoryIdBySub.get(legacy.subcategory) ?? null,
        status: "PUBLISHED",
        publishedAt: new Date(legacy.createdAt),
        pricePaise: Math.round(legacy.price * 100),
        salePricePaise:
          legacy.isOnSale && legacy.salePrice
            ? Math.round(legacy.salePrice * 100)
            : null,
        isFeatured: Boolean(legacy.isFeatured),
        position: index,
        ratingAvg: legacy.rating ?? 0,
        reviewCount: legacy.reviewCount ?? 0,
        orderCount: legacy.orderCount ?? 0,
        createdAt: new Date(legacy.createdAt),
      },
    });

    for (const [vIndex, legacyVariant] of (legacy.variants ?? []).entries()) {
      // 14 of the 78 variants already carry ids in the storefront data
      // (the 7 tote products, shaped "tote-001-brown"). Preserve those exactly
      // and mint the same shape for the rest, so a shopper's saved cart key
      // keeps resolving after cutover.
      const variantId =
        legacyVariant.id ?? `${legacy.id}-${slugify(legacyVariant.name)}`;

      const variant = await db.productVariant.upsert({
        where: { id: variantId },
        update: {},
        create: {
          id: variantId,
          productId: product.id,
          name: legacyVariant.name,
          sku: `${legacy.id.toUpperCase()}-${slugify(legacyVariant.name).toUpperCase()}`,
          position: vIndex,
          isActive: true,
        },
      });
      variantCount += 1;

      // The legacy data repeats the same file three times per variant. Storing
      // three identical rows would make the gallery show three identical
      // slides, so duplicates are collapsed and the count is reported.
      const uniqueImages = [...new Set(legacyVariant.images ?? [])];
      collapsedDuplicates +=
        (legacyVariant.images?.length ?? 0) - uniqueImages.length;

      for (const [imgIndex, url] of uniqueImages.entries()) {
        const mediaId = await ensureMedia(
          url,
          `products/${legacy.subcategory}`,
          `${legacy.title} - ${legacyVariant.name}`,
        );

        const existing = await db.productImage.findFirst({
          where: { productId: product.id, variantId: variant.id, mediaId },
        });

        if (!existing) {
          await db.productImage.create({
            data: {
              productId: product.id,
              variantId: variant.id,
              mediaId,
              alt: `${legacy.title} - ${legacyVariant.name}`,
              position: imgIndex,
            },
          });
          imageCount += 1;
        }
      }

      // Opening stock as an explicit ledger entry, not an invented number.
      const inventory = await db.inventoryItem.findUnique({
        where: { variantId: variant.id },
      });

      if (!inventory) {
        await db.inventoryItem.create({
          data: {
            variantId: variant.id,
            onHand: OPENING_STOCK,
            reserved: 0,
            lowStockThreshold: 3,
          },
        });
        await db.stockMovement.create({
          data: {
            variantId: variant.id,
            delta: OPENING_STOCK,
            type: "SEED",
            reason: "Opening stock",
            note: "Set by the initial import. The storefront has no inventory data, so this is a starting balance for the operator to correct.",
            balance: OPENING_STOCK,
          },
        });
      }
    }
  }

  return { variantCount, imageCount, collapsedDuplicates };
}

// ---------------------------------------------------------------------------
// Content: the homepage section registry
// ---------------------------------------------------------------------------

/** Hardcoded inside TrustBadges.jsx today - there is no data file for it. */
const TRUST_BADGES = [
  { icon: "package", title: "Free Shipping", text: "Orders over ₹10,000" },
  { icon: "shield", title: "2-Year Warranty", text: "Crafted to last" },
  { icon: "refresh-cw", title: "Easy Returns", text: "30-day returns" },
  { icon: "circle-help", title: "Help Centre", text: "We're here to help" },
];

/** Hardcoded inside HomePage.jsx today. */
const NEWSLETTER = {
  eyebrow: "STAY IN THE LOOP",
  title: "Join the Niya Circle",
  description:
    "Be the first to know about new collections, private sales, and styling stories.",
  placeholder: "Your email address",
  buttonText: "Subscribe →",
};

async function upsertSection(input: {
  key: string;
  page: string;
  type: string;
  title: string;
  position: number;
  payload: unknown;
  enabled?: boolean;
}) {
  return db.contentSection.upsert({
    where: { key: input.key },
    update: { title: input.title, position: input.position, page: input.page, type: input.type },
    create: {
      key: input.key,
      page: input.page,
      type: input.type,
      title: input.title,
      position: input.position,
      enabled: input.enabled ?? true,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
    },
  });
}

async function replaceBlocks(
  sectionId: string,
  blocks: Array<{
    legacyId?: string | null;
    payload: unknown;
    mediaUrl?: string | null;
    enabled?: boolean;
    folder?: string;
  }>,
) {
  const existing = await db.contentBlock.count({ where: { sectionId } });
  if (existing > 0) return;

  for (const [index, block] of blocks.entries()) {
    const mediaId = block.mediaUrl
      ? await ensureMedia(block.mediaUrl, block.folder ?? "content")
      : null;

    await db.contentBlock.create({
      data: {
        sectionId,
        legacyId: block.legacyId ?? null,
        position: index,
        enabled: block.enabled ?? true,
        payload: block.payload as Prisma.InputJsonValue,
        mediaId,
      },
    });
  }
}

async function seedContent(home: LegacyHome) {
  // Order mirrors HomePage.jsx exactly: hero, categories, featured, trust
  // badges, campaign, reels, craftsmanship, reviews, newsletter.
  const announcementBar = await upsertSection({
    key: "global.announcement_bar",
    page: "global",
    type: "announcement_bar",
    title: "Announcement bar",
    position: 0,
    payload: { rotateSeconds: 4 },
  });
  await replaceBlocks(
    announcementBar.id,
    home.announcements.map((item) => ({
      legacyId: String(item.id),
      payload: { text: item.text },
    })),
  );

  const hero = await upsertSection({
    key: "home.hero",
    page: "home",
    type: "hero",
    title: "Hero banner",
    position: 1,
    payload: { autoplaySeconds: 6 },
  });
  await replaceBlocks(
    hero.id,
    home.heroBanners.map((banner) => ({
      legacyId: banner.id,
      mediaUrl: banner.image,
      folder: "content/hero",
      payload: {
        title: banner.title,
        subtitle: banner.subtitle,
        buttonText: banner.buttonText,
        buttonLink: banner.buttonLink,
        image: banner.image,
      },
    })),
  );

  await upsertSection({
    key: "home.categories",
    page: "home",
    type: "categories",
    title: "Category grid",
    position: 2,
    payload: {
      heading: "Shop by category",
      // The storefront derives this list from products; the admin can later
      // pin an explicit order once the storefront reads /categories.
      source: "derived",
      limit: 8,
    },
  });

  await upsertSection({
    key: "home.featured_products",
    page: "home",
    type: "featured_products",
    title: "Featured products",
    position: 3,
    payload: {
      heading: "Featured",
      limit: 4,
      note: "FeaturedProducts.jsx slices to 4. 16 products are flagged featured, so 12 never appear on the homepage.",
    },
  });

  const trust = await upsertSection({
    key: "home.trust_badges",
    page: "home",
    type: "trust_badges",
    title: "Trust badges",
    position: 4,
    payload: { marquee: true },
  });
  await replaceBlocks(
    trust.id,
    TRUST_BADGES.map((badge) => ({ payload: badge })),
  );

  await upsertSection({
    key: "home.campaign_spotlight",
    page: "home",
    type: "campaign_spotlight",
    title: "Campaign spotlight",
    position: 5,
    payload: home.campaign,
  });
  if (typeof home.campaign?.image === "string") {
    await ensureMedia(home.campaign.image as string, "content/campaign");
  }

  const reels = await upsertSection({
    key: "home.reels",
    page: "home",
    type: "reels",
    title: "Reels",
    position: 6,
    payload: { heading: "In motion" },
  });
  await replaceBlocks(
    reels.id,
    home.reels.map((reel) => ({
      legacyId: String(reel.id),
      mediaUrl: reel.video,
      folder: "content/reels",
      enabled: reel.isActive,
      payload: { title: reel.title, video: reel.video, caption: "", link: "" },
    })),
  );

  await upsertSection({
    key: "home.brand_craftsmanship",
    page: "home",
    type: "brand_craftsmanship",
    title: "Brand / craftsmanship",
    position: 7,
    payload: home.craftsmanship,
  });
  if (typeof home.craftsmanship?.image === "string") {
    await ensureMedia(home.craftsmanship.image as string, "content/craftsmanship");
  }

  await upsertSection({
    key: "home.customer_reviews",
    page: "home",
    type: "customer_reviews",
    title: "Customer reviews",
    position: 8,
    payload: {
      heading: "What our customers say",
      source: "featured",
      limit: 3,
    },
  });

  await upsertSection({
    key: "home.newsletter",
    page: "home",
    type: "newsletter",
    title: "Newsletter",
    position: 9,
    payload: NEWSLETTER,
  });

  // Promo banners are already page + position targeted in the storefront, so
  // that model is preserved rather than flattened into the homepage list.
  const promo = await upsertSection({
    key: "global.promo_banners",
    page: "global",
    type: "promo_banner",
    title: "Promo banners",
    position: 10,
    payload: {
      slots: [
        { page: "home", position: "after-hero" },
        { page: "shop", position: "after-hero" },
        { page: "wishlist", position: "after-products" },
      ],
    },
  });
  await replaceBlocks(
    promo.id,
    home.promoBanners.map((banner) => ({
      legacyId: banner.id,
      mediaUrl: banner.image,
      folder: "content/promo",
      enabled: banner.isActive,
      payload: {
        page: banner.page,
        position: banner.position,
        image: banner.image,
        title: banner.title,
        alt: banner.alt,
      },
    })),
  );
}

async function seedTestimonials(home: LegacyHome) {
  // The three homepage testimonials have no rating, no product and no date.
  // CustomerReviews.jsx renders `review.rating || 5`, so a null rating is safe.
  for (const [index, review] of home.reviews.entries()) {
    const existing = await db.review.findFirst({
      where: { isTestimonial: true, authorName: review.name },
    });
    if (existing) continue;

    await db.review.create({
      data: {
        authorName: review.name,
        authorLocation: review.location,
        body: review.text,
        rating: null,
        status: "APPROVED",
        isFeatured: true,
        isTestimonial: true,
        position: index,
      },
    });
  }
}

async function seedCms(footer: LegacyFooter) {
  for (const [slug, page] of Object.entries(footer.pages)) {
    const { eyebrow, title, intro, sections, faqs, ...extra } = page as {
      eyebrow?: string;
      title?: string;
      intro?: string;
      sections?: unknown[];
      faqs?: Array<{ question: string; answer: string }>;
      [key: string]: unknown;
    };

    delete extra.slug;

    await db.cmsPage.upsert({
      where: { slug },
      update: {},
      create: {
        slug,
        title: title ?? titleCase(slug.replace(/-/g, " ")),
        eyebrow: eyebrow ?? null,
        intro: intro ?? null,
        body: (sections ?? []) as Prisma.InputJsonValue,
        extra: extra as Prisma.InputJsonValue,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });

    // The FAQ page's questions become first-class rows so they can be
    // reordered and toggled independently of the page copy.
    if (faqs?.length) {
      for (const [index, faq] of faqs.entries()) {
        const existing = await db.faq.findFirst({
          where: { question: faq.question },
        });
        if (existing) continue;
        await db.faq.create({
          data: {
            question: faq.question,
            answer: faq.answer,
            group: "General",
            position: index,
            enabled: true,
          },
        });
      }
    }
  }

  const f = footer.footer;
  await db.footerConfig.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      brandName: f.brand.name,
      brandDescription: f.brand.description,
      socialLinks: f.socialLinks as Prisma.InputJsonValue,
      sections: f.sections as Prisma.InputJsonValue,
      customerService: f.customerService as Prisma.InputJsonValue,
      legalLinks: f.legalLinks as Prisma.InputJsonValue,
      copyright: f.copyright,
    },
  });
}

// ---------------------------------------------------------------------------
// Demo orders - synthetic, flagged, and removable
// ---------------------------------------------------------------------------

const DEMO_CUSTOMERS = [
  ["Ananya Mehta", "ananya.mehta@example.com", "Mumbai", "Maharashtra", "400001"],
  ["Priya Raghunathan", "priya.r@example.com", "New Delhi", "Delhi", "110001"],
  ["Meera Suresh", "meera.s@example.com", "Bengaluru", "Karnataka", "560001"],
  ["Kavya Nair", "kavya.nair@example.com", "Kochi", "Kerala", "682001"],
  ["Ishita Bansal", "ishita.b@example.com", "Jaipur", "Rajasthan", "302001"],
  ["Rhea Kapoor", "rhea.kapoor@example.com", "Pune", "Maharashtra", "411001"],
  ["Sanya Gupta", "sanya.g@example.com", "Lucknow", "Uttar Pradesh", "226001"],
  ["Tara Iyer", "tara.iyer@example.com", "Chennai", "Tamil Nadu", "600001"],
  ["Nisha Verma", "nisha.verma@example.com", "Indore", "Madhya Pradesh", "452001"],
  ["Aditi Joshi", "aditi.joshi@example.com", "Ahmedabad", "Gujarat", "380001"],
  ["Riya Chatterjee", "riya.c@example.com", "Kolkata", "West Bengal", "700001"],
  ["Simran Kaur", "simran.k@example.com", "Chandigarh", "Punjab", "160001"],
] as const;

const DEMO_STATUS_PLAN: Array<{
  status: string;
  paymentStatus: string;
  weight: number;
}> = [
  { status: "DELIVERED", paymentStatus: "PAID", weight: 42 },
  { status: "SHIPPED", paymentStatus: "PENDING", weight: 14 },
  { status: "PROCESSING", paymentStatus: "PENDING", weight: 12 },
  { status: "CONFIRMED", paymentStatus: "PENDING", weight: 10 },
  { status: "PLACED", paymentStatus: "PENDING", weight: 12 },
  { status: "CANCELLED", paymentStatus: "PENDING", weight: 7 },
  { status: "RETURNED", paymentStatus: "REFUNDED", weight: 3 },
];

function weightedStatus() {
  const total = DEMO_STATUS_PLAN.reduce((sum, s) => sum + s.weight, 0);
  let roll = rand() * total;
  for (const entry of DEMO_STATUS_PLAN) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return DEMO_STATUS_PLAN[0];
}

async function seedDemoOrders() {
  const alreadySeeded = await db.setting.findUnique({
    where: { key: "demo.ordersSeeded" },
  });
  if (alreadySeeded?.value === "true") return 0;

  const variants = await db.productVariant.findMany({
    include: { product: true, inventory: true },
  });
  if (variants.length === 0) return 0;

  const customers = [];
  for (const [fullName, email, city, state, pinCode] of DEMO_CUSTOMERS) {
    const customer = await db.customer.upsert({
      where: { email },
      update: {},
      create: {
        email,
        fullName,
        phone: `9${randInt(100000000, 999999999)}`,
        addresses: {
          create: {
            fullName,
            line1: `${randInt(1, 240)}, ${pick(["Rose Villa", "Lake View Apartments", "Green Park", "Sunrise Residency"])}`,
            city,
            state,
            pinCode,
            isDefault: true,
          },
        },
      },
      include: { addresses: true },
    });
    customers.push({ customer, city, state, pinCode, fullName, email });
  }

  const ORDER_COUNT = 64;
  let created = 0;

  for (let i = 0; i < ORDER_COUNT; i += 1) {
    const buyer = pick(customers);
    const plan = weightedStatus();
    const placedAt = daysAgo(randInt(0, 89), randInt(9, 21));
    const orderNumber = `NIYA-${placedAt.getTime()}${i}`;

    const lineCount = randInt(1, 3);
    const chosen: typeof variants = [];
    while (chosen.length < lineCount) {
      const candidate = pick(variants);
      if (!chosen.some((v) => v.id === candidate.id)) chosen.push(candidate);
    }

    const items = chosen.map((variant) => {
      const listPricePaise = variant.product.pricePaise;
      const unitPricePaise = variant.product.salePricePaise ?? listPricePaise;
      const quantity = randInt(1, 2);
      return {
        variantId: variant.id,
        productId: variant.productId,
        titleSnapshot: variant.product.title,
        variantSnapshot: variant.name,
        skuSnapshot: variant.sku,
        listPricePaise,
        unitPricePaise,
        quantity,
        lineTotalPaise: unitPricePaise * quantity,
      };
    });

    const subtotalPaise = items.reduce((sum, item) => sum + item.lineTotalPaise, 0);
    // Matches the storefront rule in OrderPage.jsx: free above Rs 2,000.
    const shippingPaise = subtotalPaise >= 200000 ? 0 : 10000;
    const totalPaise = subtotalPaise + shippingPaise;
    const paymentMethod = rand() < 0.78 ? "COD" : "ONLINE";

    const order = await db.order.create({
      data: {
        orderNumber,
        customerId: buyer.customer.id,
        status: plan.status,
        paymentStatus: plan.paymentStatus,
        paymentMethod,
        source: "STOREFRONT",
        subtotalPaise,
        shippingPaise,
        totalPaise,
        refundedPaise: plan.paymentStatus === "REFUNDED" ? totalPaise : 0,
        shipFullName: buyer.fullName,
        shipEmail: buyer.email,
        shipPhone: buyer.customer.phone ?? "",
        shipAddress: buyer.customer.addresses?.[0]?.line1 ?? "",
        shipCity: buyer.city,
        shipState: buyer.state,
        shipPinCode: buyer.pinCode,
        placedAt,
        createdAt: placedAt,
        confirmedAt: ["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "RETURNED"].includes(plan.status)
          ? new Date(placedAt.getTime() + 3600_000)
          : null,
        shippedAt: ["SHIPPED", "DELIVERED", "RETURNED"].includes(plan.status)
          ? new Date(placedAt.getTime() + 86400_000)
          : null,
        deliveredAt: ["DELIVERED", "RETURNED"].includes(plan.status)
          ? new Date(placedAt.getTime() + 3 * 86400_000)
          : null,
        cancelledAt: plan.status === "CANCELLED" ? new Date(placedAt.getTime() + 7200_000) : null,
        cancelReason: plan.status === "CANCELLED" ? pick(["Customer requested", "Address unreachable", "Out of stock"]) : null,
        items: { create: items },
        events: {
          create: [
            {
              type: "SYSTEM",
              message: "Sample order created by the database seeder. Not a real customer order.",
              isInternal: true,
              createdAt: placedAt,
            },
            {
              type: "STATUS_CHANGE",
              toStatus: "PLACED",
              message: "Order placed",
              createdAt: placedAt,
            },
          ],
        },
      },
    });

    // Non-cancelled orders consume stock through the ledger, so low-stock and
    // out-of-stock states on the dashboard are a real consequence of the data.
    if (plan.status !== "CANCELLED") {
      for (const item of items) {
        const inventory = await db.inventoryItem.findUnique({
          where: { variantId: item.variantId },
        });
        if (!inventory) continue;

        const balance = inventory.onHand - item.quantity;
        await db.inventoryItem.update({
          where: { variantId: item.variantId },
          data: { onHand: balance },
        });
        await db.stockMovement.create({
          data: {
            variantId: item.variantId,
            delta: -item.quantity,
            type: "SALE",
            reason: `Order ${orderNumber}`,
            orderId: order.id,
            balance,
            createdAt: placedAt,
          },
        });
      }
    }

    created += 1;
  }

  // Recompute the legacy orderCount from real order lines rather than trusting
  // the hardcoded numbers in products.js.
  const grouped = await db.orderItem.groupBy({
    by: ["productId"],
    _sum: { quantity: true },
  });
  for (const row of grouped) {
    if (!row.productId) continue;
    await db.product.update({
      where: { id: row.productId },
      data: { orderCount: row._sum.quantity ?? 0 },
    });
  }

  await db.setting.upsert({
    where: { key: "demo.ordersSeeded" },
    update: { value: "true" },
    create: {
      key: "demo.ordersSeeded",
      value: "true",
      type: "boolean",
      group: "system",
      label: "Demo orders present",
      helpText:
        "Sample orders and customers were generated by the seeder so the dashboard has something to render. Run `npm run db:reset` to clear them.",
    },
  });

  return created;
}

async function seedNotifications() {
  const count = await db.notification.count();
  if (count > 0) return;

  const lowStock = await db.inventoryItem.findMany({
    where: { onHand: { lte: 3 } },
    include: { variant: { include: { product: true } } },
    take: 5,
  });

  for (const item of lowStock) {
    await db.notification.create({
      data: {
        type: item.onHand <= 0 ? "OUT_OF_STOCK" : "LOW_STOCK",
        severity: item.onHand <= 0 ? "critical" : "warning",
        title:
          item.onHand <= 0
            ? `${item.variant.product.title} (${item.variant.name}) is out of stock`
            : `${item.variant.product.title} (${item.variant.name}) is low on stock`,
        body: `${item.onHand} left on hand.`,
        entityType: "variant",
        entityId: item.variantId,
        href: `/inventory?q=${encodeURIComponent(item.variant.product.title)}`,
      },
    });
  }
}

// ---------------------------------------------------------------------------

async function main() {
  console.log("Seeding Niya admin database...\n");

  const products = await readSnapshot<LegacyProduct[]>("products.json");
  const home = await readSnapshot<LegacyHome>("home.json");
  const footer = await readSnapshot<LegacyFooter>("footer.json");

  const admin = await seedUsers();
  await seedSettings();
  const catalog = await seedCatalog(products);
  await seedContent(home);
  await seedTestimonials(home);
  await seedCms(footer);

  let demoOrders = 0;
  if (SEED_DEMO) {
    demoOrders = await seedDemoOrders();
  }
  await seedNotifications();

  await db.auditLog.create({
    data: {
      actorId: admin.id,
      actorEmail: admin.email,
      action: "system.seed",
      entityType: "system",
      summary: `Imported ${products.length} products, ${catalog.variantCount} variants and all storefront content.`,
    },
  });

  const media = await db.mediaAsset.count();

  console.log("Imported from the storefront (real data):");
  console.log(`  products        ${products.length}`);
  console.log(`  variants        ${catalog.variantCount}`);
  console.log(`  product images  ${catalog.imageCount} (collapsed ${catalog.collapsedDuplicates} duplicate references)`);
  console.log(`  media assets    ${media}`);
  console.log(`  content blocks  ${await db.contentBlock.count()} across ${await db.contentSection.count()} sections`);
  console.log(`  cms pages       ${await db.cmsPage.count()}`);
  console.log(`  faqs            ${await db.faq.count()}`);
  console.log(`  testimonials    ${await db.review.count({ where: { isTestimonial: true } })}`);

  console.log("\nChosen defaults (not from the storefront):");
  console.log(`  opening stock   ${OPENING_STOCK} per variant, recorded as a SEED ledger entry`);

  if (demoOrders > 0) {
    console.log("\n  ** SAMPLE DATA **");
    console.log(`  ${demoOrders} demo orders and ${DEMO_CUSTOMERS.length} demo customers were generated.`);
    console.log("  The storefront never transmits orders, so there is no real history to import.");
    console.log("  Disable with SEED_DEMO_ORDERS=false, clear with `npm run db:reset`.");
  }

  console.log(`\nAdmin login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log("Customer (USER role, must be refused the dashboard): customer@example.com / Customer@12345\n");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
