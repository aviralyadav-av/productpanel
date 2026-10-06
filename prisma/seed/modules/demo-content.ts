import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

import { SECTION_REGISTRY, sectionKeyFor } from "@/features/content/registry";
import { renderTemplate } from "@/features/email/render";
import { sanitizeHtml } from "@/lib/sanitize/html";
import type { ContentSectionType } from "@/lib/enums";
import type { SeedContext } from "./context";
import { formatInr } from "../lib/money";
import { heroBannerSvg, putDemoSvg } from "../lib/placeholders";
import { addDays, addHours, createRng, daysAgo, minDate, type Rng } from "../lib/rng";
import { categoryBySlug, demoId, mediaId, registerMedia, state, INDIAN_CITIES } from "../lib/state";

/**
 * Storefront content and communication (blueprint §12, §14.E1): banners for
 * every placement, the homepage section list validated against the section
 * registry, blog, FAQs, ~120 reviews (verified ones tied to delivered order
 * lines), inquiries with replies, newsletter subscribers, admin notifications
 * and a few SENT outbox rows rendered from the real templates.
 *
 * Runs last because reviews and notifications point at orders. Everything
 * upserts on a stable id (or creates only when the parent has no children),
 * so an admin's edits to a banner or a section payload survive re-seeding.
 */

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

type BannerSpec = {
  key: string;
  placement: string;
  title: string;
  subtitle: string;
  hue: number;
  buttonText?: string;
  link: { type: "CATEGORY"; slug: string } | { type: "PRODUCT"; n: number } | { type: "PAGE"; slug: string } | { type: "URL"; url: string } | { type: "NONE" };
  position: number;
  isActive?: boolean;
  window?: "scheduled" | "expired";
  textColor?: string;
  bgColor?: string;
  withMedia?: boolean;
};

const BANNERS: BannerSpec[] = [
  { key: "hero-1", placement: "HOME_HERO", title: "Handmade for the festive season", subtitle: "Diyas, hampers, brass and block prints from 40 artisans - 10% off Home & Living this week.", hue: 22, buttonText: "Shop Home & Living", link: { type: "CATEGORY", slug: "home-living" }, position: 0 },
  { key: "hero-2", placement: "HOME_HERO", title: "Gifts made just for them", subtitle: "Names, photos, engraving and messages - reviewed by the maker before it is made.", hue: 195, buttonText: "Personalise a gift", link: { type: "CATEGORY", slug: "personalised-gifts" }, position: 1 },
  { key: "hero-3", placement: "HOME_HERO", title: "Original art, straight from the studio", subtitle: "Madhubani, Warli, watercolour and commissioned portraits from Mithila Art House.", hue: 262, buttonText: "Browse paintings", link: { type: "CATEGORY", slug: "paintings" }, position: 2 },
  { key: "promo-1", placement: "HOME_PROMO", title: "Jewellery under ₹999", subtitle: "Oxidised silver, meenakari and terracotta.", hue: 42, buttonText: "Shop jewellery", link: { type: "CATEGORY", slug: "jewellery" }, position: 0 },
  { key: "promo-2", placement: "HOME_PROMO", title: "The personalised mug", subtitle: "Hand-lettered with any name, from ₹449.", hue: 195, buttonText: "Make mine", link: { type: "PRODUCT", n: 44 }, position: 1 },
  { key: "promo-3", placement: "HOME_PROMO", title: "Handloom kurtas", subtitle: "Block prints and khadi for every day.", hue: 335, buttonText: "Shop kurtas", link: { type: "CATEGORY", slug: "kurta" }, position: 2 },
  { key: "strip-1", placement: "HOME_STRIP", title: "Free shipping above ₹999 · 7-day returns · Cash on delivery", subtitle: "", hue: 150, link: { type: "PAGE", slug: "shipping-policy" }, position: 0, withMedia: false, bgColor: "#1f3d2b", textColor: "#ffffff" },
  { key: "cat-jewellery", placement: "CATEGORY_TOP", title: "Jewellery from Rajasthan's ateliers", subtitle: "Use JEWEL15 for 15% off.", hue: 42, buttonText: "Apply JEWEL15", link: { type: "CATEGORY", slug: "jewellery" }, position: 0 },
  { key: "cat-paintings", placement: "CATEGORY_TOP", title: "Commission a portrait", subtitle: "From your photo, in 10-14 days.", hue: 262, buttonText: "Start a commission", link: { type: "PRODUCT", n: 71 }, position: 0 },
  { key: "announce-1", placement: "ANNOUNCEMENT", title: "Diwali sale starts in two weeks - DIWALI25 for 25% off", subtitle: "", hue: 22, link: { type: "URL", url: "/sale" }, position: 0, withMedia: false, window: "scheduled", bgColor: "#7b1e3a", textColor: "#ffffff" },
  { key: "popup-1", placement: "POPUP", title: "10% off your first order", subtitle: "Use WELCOME10 at checkout. Handmade, personalised, delivered.", hue: 335, buttonText: "Claim WELCOME10", link: { type: "URL", url: "/?coupon=WELCOME10" }, position: 0 },
  { key: "sidebar-1", placement: "SIDEBAR", title: "Meet the makers", subtitle: "Every seller is an independent artisan.", hue: 150, buttonText: "Read their stories", link: { type: "URL", url: "/blog" }, position: 0 },
  { key: "checkout-1", placement: "CHECKOUT", title: "Add FREESHIP for free delivery above ₹599", subtitle: "", hue: 195, link: { type: "NONE" }, position: 0, withMedia: false, bgColor: "#e8f4f1", textColor: "#0f3d33" },
  { key: "promo-old", placement: "HOME_PROMO", title: "Monsoon bag clearance", subtitle: "₹200 off selected bags - ended.", hue: 335, buttonText: "Shop bags", link: { type: "CATEGORY", slug: "bags" }, position: 3, window: "expired" },
];

async function seedBanners(db: PrismaClient, ctx: SeedContext): Promise<number> {
  const now = state.now;
  const pages = new Map((await db.cmsPage.findMany({ select: { id: true, slug: true } })).map((page) => [page.slug, page.id]));
  let count = 0;
  for (const spec of BANNERS) {
    let mediaAssetId: string | null = null;
    if (spec.withMedia !== false) {
      const asset = await putDemoSvg(db, {
        id: demoId("media_banner", spec.key),
        key: `demo/banners/${spec.key}.svg`,
        svg: heroBannerSvg({ heading: spec.title, subheading: spec.subtitle, hue: spec.hue, buttonText: spec.buttonText, eyebrow: spec.placement.replace("_", " ") }),
        folderId: mediaId("folder:demo/banners"),
        alt: spec.title,
        width: 1600,
        height: 600,
        uploadedById: ctx.adminUserId,
      });
      registerMedia(`banner:${spec.key}`, asset.id, asset.url);
      mediaAssetId = asset.id;
    }
    const link = spec.link;
    await db.banner.upsert({
      where: { id: demoId("banner", spec.key) },
      update: {},
      create: {
        id: demoId("banner", spec.key),
        title: spec.title,
        subtitle: spec.subtitle || null,
        placement: spec.placement,
        mediaId: mediaAssetId,
        altText: spec.title,
        linkType: link.type,
        linkUrl: link.type === "URL" ? link.url : null,
        categoryId: link.type === "CATEGORY" ? categoryBySlug(link.slug).id : null,
        productId: link.type === "PRODUCT" ? demoId("prod", link.n) : null,
        pageId: link.type === "PAGE" ? pages.get(link.slug) ?? null : null,
        buttonText: spec.buttonText ?? null,
        textColor: spec.textColor ?? null,
        bgColor: spec.bgColor ?? null,
        position: spec.position,
        isActive: spec.isActive ?? true,
        startsAt: spec.window === "scheduled" ? addDays(now, 14) : spec.window === "expired" ? daysAgo(now, 70) : null,
        endsAt: spec.window === "scheduled" ? addDays(now, 35) : spec.window === "expired" ? daysAgo(now, 25) : null,
        clickCount: spec.window === "expired" ? 412 : 0,
        impressionCount: spec.window === "expired" ? 18_940 : 0,
        createdAt: daysAgo(now, 30 + spec.position),
      },
    });
    count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Homepage sections (E1) - payloads validated by the registry
// ---------------------------------------------------------------------------

type SectionSpec = {
  type: ContentSectionType;
  title: string;
  subtitle?: string;
  payload: Record<string, unknown>;
  blocks?: Array<Record<string, unknown>>;
  linkType?: string;
  linkUrl?: string;
  linkTargetId?: string;
  buttonText?: string;
};

async function seedHomepage(db: PrismaClient, ctx: SeedContext): Promise<{ sections: number; blocks: number }> {
  const featured = state.products.filter((product) => product.status === "PUBLISHED" && product.isBestseller).slice(0, 8).map((product) => product.id);
  const sections: SectionSpec[] = [
    { type: "hero_slider", title: "Hero slider", payload: { placement: "HOME_HERO", limit: 5, autoplaySeconds: 6 } },
    {
      type: "announcement_bar",
      title: "Announcement bar",
      payload: { rotateSeconds: 5 },
      blocks: [
        { text: "Free shipping on orders above ₹999", linkUrl: "/shipping-policy" },
        { text: "WELCOME10 - 10% off your first order", linkUrl: "" },
        { text: "Personalised gifts ship in 5-7 working days", linkUrl: "" },
      ],
    },
    { type: "featured_categories", title: "Shop by category", subtitle: "Six worlds of handmade", payload: { source: "auto", categoryIds: [], limit: 6 }, linkType: "URL", linkUrl: "/categories", buttonText: "All categories" },
    { type: "promo_banners", title: "This week", payload: { placement: "HOME_PROMO", limit: 3, layout: "grid" } },
    { type: "new_arrivals", title: "New arrivals", subtitle: "Fresh from the workshop", payload: { source: "auto", productIds: [], categoryId: null, limit: 8 }, linkType: "URL", linkUrl: "/new", buttonText: "See all new" },
    { type: "best_sellers", title: "Best sellers", payload: { source: "auto", productIds: [], categoryId: null, limit: 8 }, linkType: "URL", linkUrl: "/best-sellers", buttonText: "Shop best sellers" },
    { type: "trending", title: "Trending now", payload: { source: "auto", productIds: [], categoryId: null, limit: 8 } },
    { type: "featured_products", title: "Editor's picks", subtitle: "Hand-picked by the DIY Baazar team", payload: { source: "manual", productIds: featured, categoryId: null, limit: 8 } },
    { type: "seller_highlights", title: "Meet the makers", subtitle: "Independent artisans, fairly paid", payload: { source: "auto", sellerIds: [], limit: 4 }, linkType: "URL", linkUrl: "/sellers", buttonText: "All makers" },
    { type: "testimonials", title: "What customers say", payload: { source: "auto", reviewIds: [], limit: 6 } },
    { type: "product_reviews", title: "Recent reviews", payload: { limit: 6, minRating: 4 } },
    {
      type: "promo_section",
      title: "Personalised gifts",
      payload: {
        imageMediaId: mediaId("banner:hero-2"),
        mobileImageMediaId: "",
        heading: "Gifts made just for them",
        text: "Names, photos, engraving and messages - every personalised order is checked by the maker before it is made.",
        buttonText: "Shop personalised gifts",
        linkType: "CATEGORY",
        linkUrl: "",
        linkTargetId: categoryBySlug("personalised-gifts").id,
        align: "left",
      },
    },
    { type: "newsletter", title: "Newsletter", payload: { heading: "Stories from the workshop", text: "New makers, new arrivals and festive collections - twice a month, no spam.", placeholder: "Your email address", buttonText: "Subscribe" } },
    {
      type: "trust_badges",
      title: "Why DIY Baazar",
      payload: {},
      blocks: [
        { iconName: "truck", title: "Free shipping above ₹999", text: "Across India, tracked" },
        { iconName: "refresh-cw", title: "7-day easy returns", text: "On eligible items" },
        { iconName: "shield-check", title: "Secure payments", text: "UPI, cards, net banking & COD" },
        { iconName: "hand-heart", title: "Direct from artisans", text: "Fair pay, no middlemen" },
      ],
    },
    { type: "footer", title: "Footer", payload: {} },
  ];

  let blocksCreated = 0;
  for (const [position, spec] of sections.entries()) {
    const definition = SECTION_REGISTRY[spec.type];
    const payload = definition.sectionSchema.parse(spec.payload) as Prisma.InputJsonValue;
    const key = sectionKeyFor(spec.type);
    const section = await db.contentSection.upsert({
      where: { key },
      update: {},
      create: {
        id: demoId("section", spec.type),
        key,
        page: "home",
        type: spec.type,
        title: spec.title,
        subtitle: spec.subtitle ?? null,
        position,
        enabled: true,
        linkType: spec.linkType ?? "NONE",
        linkUrl: spec.linkUrl ?? null,
        linkTargetId: spec.linkTargetId ?? null,
        buttonText: spec.buttonText ?? null,
        payload,
      },
      select: { id: true, _count: { select: { blocks: true } } },
    });
    if (spec.blocks && section._count.blocks === 0) {
      await db.contentBlock.createMany({
        data: spec.blocks.map((block, index) => ({
          id: demoId("block", spec.type, index + 1),
          sectionId: section.id,
          position: index,
          enabled: true,
          payload: definition.blockSchema.parse(block) as Prisma.InputJsonValue,
        })),
      });
      blocksCreated += spec.blocks.length;
    }
  }
  void ctx;
  return { sections: sections.length, blocks: blocksCreated };
}

// ---------------------------------------------------------------------------
// Blog, FAQs
// ---------------------------------------------------------------------------

const BLOG_CATEGORIES = [
  { n: 1, slug: "maker-stories", name: "Maker Stories", description: "The people and workshops behind the products." },
  { n: 2, slug: "gifting-guides", name: "Gifting Guides", description: "What to give, and how to personalise it." },
  { n: 3, slug: "care-and-craft", name: "Care & Craft", description: "Looking after handmade things, and how they are made." },
  { n: 4, slug: "behind-the-scenes", name: "Behind the Scenes", description: "News from the DIY Baazar team." },
];

type PostSpec = {
  n: number;
  slug: string;
  title: string;
  excerpt: string;
  category: number;
  tags: string[];
  hue: number;
  status: "PUBLISHED" | "DRAFT" | "SCHEDULED";
  daysAgo: number;
  isFeatured?: boolean;
  relatedProducts: number[];
  relatedCategories: string[];
  body: string;
};

const POSTS: PostSpec[] = [
  { n: 1, slug: "sunita-devi-madhubani", title: "Sunita Devi paints the Tree of Life", excerpt: "Twenty-five years of Madhubani, one bamboo nib at a time.", category: 1, tags: ["madhubani", "artisan", "bihar"], hue: 262, status: "PUBLISHED", daysAgo: 40, isFeatured: true, relatedProducts: [65, 66], relatedCategories: ["madhubani"], body: "<h2>A village of painters</h2><p>In Jitwarpur every second courtyard has a painting drying on the wall. Sunita Devi learned from her mother, who learned from hers, and now teaches thirty women in the village.</p><p>Her Tree of Life takes sixty hours. The pigments are ground at home: turmeric for yellow, indigo for blue, soot and cow-dung for black.</p><h2>Why the fish?</h2><p>Twin fish mean prosperity and fertility. They are painted for weddings and new homes, which is why they are the most-gifted piece in her shop.</p>" },
  { n: 2, slug: "personalised-gifts-guide", title: "The personalised gift guide", excerpt: "Twelve gifts that can carry a name, a photo or a message - and how long each takes to make.", category: 2, tags: ["gifting", "personalised"], hue: 195, status: "PUBLISHED", daysAgo: 25, isFeatured: true, relatedProducts: [44, 45, 47, 54, 55], relatedCategories: ["personalised-gifts", "personalised-mugs"], body: "<h2>Start with the timeline</h2><p>Hand-lettered mugs ship in two days; engraved wood needs a week; a commissioned portrait wants two. Order early and let the maker take their time.</p><h2>Our favourites</h2><ul><li>A hand-lettered name mug for the tea drinker.</li><li>A star map of the night you met.</li><li>A music box that plays their song.</li></ul><p>Every personalised product shows exactly what you can change - and the maker reviews it before it is made.</p>" },
  { n: 3, slug: "caring-for-handloom", title: "How to care for handloom cotton", excerpt: "Cold water, shade and a little patience.", category: 3, tags: ["care", "handloom", "fashion"], hue: 335, status: "PUBLISHED", daysAgo: 18, relatedProducts: [18, 22, 24], relatedCategories: ["fashion"], body: "<h2>First wash</h2><p>Natural dyes bleed a little the first time. Wash separately in cold water with a mild detergent and skip the soak.</p><h2>Drying</h2><p>Dry in the shade, inside out. Direct sun fades indigo faster than anything else.</p><h2>Ironing</h2><p>Iron while slightly damp on medium heat. Block-printed fabric softens with every wash - that is the point.</p>" },
  { n: 4, slug: "kalakriti-studio-jaipur", title: "Inside Kalakriti Studio, Jaipur", excerpt: "Brass, wood and wax under one roof in Bani Park.", category: 1, tags: ["artisan", "jaipur", "home-decor"], hue: 22, status: "PUBLISHED", daysAgo: 10, relatedProducts: [1, 9, 14], relatedCategories: ["home-living"], body: "<h2>Three crafts, one family</h2><p>Meera Sharma's father turned wood, her mother knotted macramé, and she taught herself to pour candles during the lockdown. Today all three happen in the same courtyard.</p><p>Everything is signed. Turn over a serving platter and you will find a tiny brass inlay with the maker's initial.</p>" },
  { n: 5, slug: "diwali-2026-collection", title: "What's coming for Diwali 2026", excerpt: "Hampers, diyas and a festive sale - here is the plan.", category: 4, tags: ["diwali", "news"], hue: 42, status: "SCHEDULED", daysAgo: -7, relatedProducts: [49, 14], relatedCategories: ["gift-hampers"], body: "<h2>Save the date</h2><p>DIWALI25 goes live in two weeks with 25% off orders above ₹1,499. Hampers ship from three partner workshops.</p>" },
  { n: 6, slug: "why-we-pay-artisans-weekly", title: "Why we pay artisans weekly", excerpt: "A draft note on payouts, holds and trust.", category: 4, tags: ["news", "sellers"], hue: 150, status: "DRAFT", daysAgo: 2, relatedProducts: [], relatedCategories: [], body: "<p>Draft: explain the seven-day hold after delivery, the weekly payout cycle and why the minimum statement is ₹500.</p>" },
];

async function seedBlog(db: PrismaClient, ctx: SeedContext): Promise<{ categories: number; posts: number }> {
  const now = state.now;
  for (const category of BLOG_CATEGORIES) {
    await db.blogCategory.upsert({
      where: { slug: category.slug },
      update: {},
      create: { id: demoId("blogcat", category.n), slug: category.slug, name: category.name, description: category.description, position: category.n - 1, isActive: true },
    });
  }
  for (const post of POSTS) {
    const image = await putDemoSvg(db, {
      id: demoId("media_blog", post.n),
      key: `demo/blog/${post.slug}.svg`,
      svg: heroBannerSvg({ heading: post.title, subheading: post.excerpt, hue: post.hue, eyebrow: BLOG_CATEGORIES[post.category - 1].name }),
      folderId: mediaId("folder:demo/blog"),
      alt: post.title,
      width: 1600,
      height: 600,
      uploadedById: ctx.adminUserId,
    });
    const publishedAt = post.status === "DRAFT" ? null : daysAgo(now, post.daysAgo);
    await db.blogPost.upsert({
      where: { slug: post.slug },
      update: {},
      create: {
        id: demoId("blog", post.n),
        slug: post.slug,
        title: post.title,
        excerpt: post.excerpt,
        content: sanitizeHtml(post.body, "rich"),
        featuredImageMediaId: image.id,
        categoryId: demoId("blogcat", post.category),
        tags: post.tags,
        authorId: ctx.adminUserId,
        authorName: "DIY Baazar Team",
        status: post.status,
        publishedAt,
        readingMinutes: Math.max(2, Math.round(post.body.length / 900) + 2),
        viewCount: post.status === "PUBLISHED" ? 120 + post.n * 87 : 0,
        isFeatured: post.isFeatured ?? false,
        metaTitle: `${post.title} | DIY Baazar Journal`,
        metaDescription: post.excerpt,
        relatedProductIds: post.relatedProducts.map((n) => demoId("prod", n)),
        relatedCategoryIds: post.relatedCategories.map((slug) => categoryBySlug(slug).id),
        createdAt: daysAgo(now, Math.max(post.daysAgo, 0) + 3),
      },
    });
  }
  return { categories: BLOG_CATEGORIES.length, posts: POSTS.length };
}

const FAQS: Array<{ group: string; q: string; a: string; featured?: boolean }> = [
  { group: "Orders", q: "How do I track my order?", a: "<p>Open the tracking link in your shipping email, or enter your order number (it starts with <strong>DB</strong>) on the Track Order page.</p>", featured: true },
  { group: "Orders", q: "Can I change or cancel an order?", a: "<p>Yes, until the seller marks it packed. Personalised items cannot be cancelled once production has started.</p>" },
  { group: "Orders", q: "Do you offer cash on delivery?", a: "<p>Yes, on most orders. A small COD handling fee of ₹49 applies and is shown at checkout.</p>", featured: true },
  { group: "Shipping", q: "How long does delivery take?", a: "<p>Ready items ship in 2-5 working days and arrive 4-8 days after dispatch. Personalised items show their own estimate on the product page.</p>", featured: true },
  { group: "Shipping", q: "Is shipping free?", a: "<p>Standard shipping is free on orders above ₹999 after discounts. Below that it is ₹79.</p>" },
  { group: "Shipping", q: "Do you ship outside India?", a: "<p>Not yet. We are working on it - subscribe to the newsletter to hear first.</p>" },
  { group: "Returns", q: "What is your return policy?", a: "<p>Most items can be returned within 7 days of delivery. Personalised or made-to-order items are returnable only if damaged, defective or not as described.</p>", featured: true },
  { group: "Returns", q: "How long do refunds take?", a: "<p>5-7 working days after the returned item passes inspection, to the original payment method or by bank transfer for COD orders.</p>" },
  { group: "Personalisation", q: "Can I see a preview before it is made?", a: "<p>For engraved and printed items the maker checks your text and photo. If something looks wrong we contact you before production.</p>" },
  { group: "Personalisation", q: "What photo quality do you need?", a: "<p>A sharp, well-lit JPEG or PNG at least 1500 px on the long side. Phone photos in daylight are usually perfect.</p>" },
  { group: "Selling", q: "How do I become a seller?", a: "<p>Apply from the Sell on DIY Baazar page with your PAN, a bank proof and a few product photos. We review applications within a few working days.</p>" },
  { group: "Selling", q: "When do sellers get paid?", a: "<p>Earnings become available 7 days after delivery and are paid out weekly by bank transfer once the statement crosses ₹500.</p>" },
];

async function seedFaqs(db: PrismaClient): Promise<number> {
  for (const [index, faq] of FAQS.entries()) {
    await db.faq.upsert({
      where: { id: demoId("faq", index + 1) },
      update: {},
      create: { id: demoId("faq", index + 1), question: faq.q, answer: sanitizeHtml(faq.a, "basic"), group: faq.group, position: index, enabled: true, isFeatured: faq.featured ?? false },
    });
  }
  return FAQS.length;
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

const REVIEW_TEXT: Record<number, Array<{ title: string; body: string }>> = {
  5: [
    { title: "Even better in person", body: "The photos do not do it justice. Beautifully finished and packed with so much care - there was a hand-written note from the maker." },
    { title: "Exactly as described", body: "Arrived two days early. The colours are true to the listing and the quality is excellent for the price." },
    { title: "Perfect gift", body: "Bought this for my sister's housewarming and she has not stopped talking about it." },
    { title: "Will order again", body: "You can tell it is handmade in the best way. Solid, well made, and it smells of the workshop." },
  ],
  4: [
    { title: "Lovely, slightly smaller than expected", body: "Great craftsmanship. Do check the dimensions - it is a little smaller than I pictured, but I love it." },
    { title: "Good quality", body: "Well made and nicely packaged. Delivery took a day longer than the estimate." },
    { title: "Happy with the purchase", body: "Nice finish and true colours. Would have liked one more size option." },
  ],
  3: [
    { title: "Decent", body: "It is fine for the price. The finish has a few rough edges that I sanded down myself." },
    { title: "Okay", body: "Looks good but arrived with a small scuff. Customer care offered a partial refund quickly, which I appreciated." },
  ],
  2: [
    { title: "Colour was off", body: "The listing shows a deep teal; mine is closer to grey-green. The return was easy though." },
  ],
  1: [
    { title: "Arrived damaged", body: "Cracked in transit. The seller has offered a replacement, updating once it arrives." },
  ],
};

const TESTIMONIALS = [
  { name: "Priya Sharma", location: "Jaipur", body: "I have bought gifts for three weddings from DIY Baazar and every one arrived on time and beautifully packed. Knowing who made it makes all the difference." },
  { name: "Rohan Verma", location: "Bengaluru", body: "The personalised music box for our anniversary was flawless - they even checked the engraving text with me before making it." },
  { name: "Ananya Iyer", location: "Chennai", body: "Finally a marketplace where handmade actually means handmade. The Madhubani painting on our wall gets a compliment from every guest." },
];

async function seedReviews(db: PrismaClient, ctx: SeedContext, rng: Rng): Promise<{ created: number; existing: number }> {
  const now = state.now;
  const customers = state.customers.filter((customer) => customer.status === "ACTIVE");
  const cityOf = (customerId: string | null) => customers.find((customer) => customer.id === customerId)?.addresses[0]?.city ?? rng.pick(INDIAN_CITIES).city;

  const deliveredItems = await db.orderItem.findMany({
    where: { orderId: { startsWith: "demo_order_" }, deliveredAt: { not: null }, productId: { not: null }, order: { customerId: { not: null } } },
    select: { id: true, productId: true, sellerId: true, deliveredAt: true, order: { select: { customerId: true, customer: { select: { fullName: true } } } } },
    orderBy: { deliveredAt: "asc" },
  });
  const verified = rng.sample(deliveredItems, 70);
  const products = state.products.filter((product) => product.status === "PUBLISHED");
  const mediaIdByUrl = new Map([...state.mediaUrl.entries()].map(([id, url]) => [url, id]));

  const rows: Prisma.ReviewCreateManyInput[] = [];
  const images: Prisma.ReviewImageCreateManyInput[] = [];
  let n = 0;
  const push = (input: Omit<Prisma.ReviewCreateManyInput, "id">, withImage: boolean, imageUrl: string | null) => {
    n += 1;
    const id = demoId("review", n);
    rows.push({ id, ...input });
    if (withImage && imageUrl) {
      images.push({ id: demoId("rimg", n, 1), reviewId: id, mediaId: mediaIdByUrl.get(imageUrl) ?? null, url: imageUrl, position: 0 });
    }
  };
  const rating = () => rng.weighted([[5, 45], [4, 30], [3, 13], [2, 7], [1, 5]] as const);
  const status = () => rng.weighted([["APPROVED", 75], ["PENDING", 15], ["REJECTED", 10]] as const);
  let featured = 0;
  let replies = 0;

  for (const item of verified) {
    const stars = rating();
    const text = rng.pick(REVIEW_TEXT[stars]);
    const reviewStatus = status();
    const createdAt = minDate(addDays(item.deliveredAt as Date, rng.float(1, 10)), addHours(now, -1));
    const isFeatured = reviewStatus === "APPROVED" && stars >= 4 && featured < 10 && rng.chance(0.35);
    if (isFeatured) featured += 1;
    const product = products.find((candidate) => candidate.id === item.productId);
    const reply = reviewStatus === "APPROVED" && replies < 8 && rng.chance(0.2);
    if (reply) replies += 1;
    push(
      {
        productId: item.productId,
        customerId: item.order.customerId,
        sellerId: item.sellerId,
        orderItemId: item.id,
        authorName: item.order.customer?.fullName ?? "Verified buyer",
        authorLocation: cityOf(item.order.customerId),
        rating: stars,
        title: text.title,
        body: text.body,
        status: reviewStatus,
        isFeatured,
        isVerifiedPurchase: true,
        helpfulCount: reviewStatus === "APPROVED" ? rng.int(0, 25) : 0,
        reply: reply ? `Thank you so much - it means a lot to hear this. ${stars <= 3 ? "We have noted the finish issue and will do better." : "Hope it brings you joy for years."} - ${state.sellers.find((seller) => seller.id === item.sellerId)?.displayName ?? "Team DIY Baazar"}` : null,
        repliedAt: reply ? addDays(createdAt, rng.float(0.5, 3)) : null,
        repliedById: reply && !item.sellerId ? ctx.adminUserId : null,
        position: n,
        createdAt,
      },
      reviewStatus === "APPROVED" && rng.chance(0.18),
      product?.imageUrl ?? null,
    );
  }
  for (let i = 0; i < 50; i += 1) {
    const stars = rating();
    const text = rng.pick(REVIEW_TEXT[stars]);
    const product = rng.pick(products);
    const customer = rng.pick(customers);
    const reviewStatus = status();
    push(
      {
        productId: product.id,
        customerId: customer.id,
        sellerId: product.sellerId,
        authorName: customer.fullName ?? "Customer",
        authorLocation: customer.addresses[0]?.city ?? null,
        rating: stars,
        title: text.title,
        body: text.body,
        status: reviewStatus,
        isFeatured: false,
        isVerifiedPurchase: false,
        helpfulCount: reviewStatus === "APPROVED" ? rng.int(0, 12) : 0,
        position: n + 1,
        createdAt: daysAgo(now, rng.float(0.2, 80)),
      },
      false,
      null,
    );
  }
  for (const [i, testimonial] of TESTIMONIALS.entries()) {
    push(
      {
        customerId: customers[i]?.id ?? null,
        authorName: testimonial.name,
        authorLocation: testimonial.location,
        rating: 5,
        title: null,
        body: testimonial.body,
        status: "APPROVED",
        isFeatured: false,
        isTestimonial: true,
        isVerifiedPurchase: true,
        helpfulCount: rng.int(10, 60),
        position: i,
        createdAt: daysAgo(now, 20 + i * 9),
      },
      false,
      null,
    );
  }

  const created = await db.review.createMany({ data: rows, skipDuplicates: true });
  if (images.length > 0) await db.reviewImage.createMany({ data: images, skipDuplicates: true });

  // Product and seller rating projections from APPROVED reviews.
  const byProduct = await db.review.groupBy({ by: ["productId"], where: { status: "APPROVED", productId: { not: null } }, _avg: { rating: true }, _count: { _all: true } });
  for (const product of state.products) {
    const row = byProduct.find((item) => item.productId === product.id);
    await db.product.update({ where: { id: product.id }, data: { ratingAvg: Math.round((row?._avg.rating ?? 0) * 10) / 10, reviewCount: row?._count._all ?? 0 } });
  }
  const bySeller = await db.review.groupBy({ by: ["sellerId"], where: { status: "APPROVED", sellerId: { not: null } }, _avg: { rating: true }, _count: { _all: true } });
  for (const seller of state.sellers) {
    const row = bySeller.find((item) => item.sellerId === seller.id);
    await db.seller.update({ where: { id: seller.id }, data: { ratingAvg: Math.round((row?._avg.rating ?? 0) * 10) / 10, reviewCount: row?._count._all ?? 0 } });
  }
  return { created: created.count, existing: rows.length - created.count };
}

// ---------------------------------------------------------------------------
// Inquiries, newsletter, notifications, outbox
// ---------------------------------------------------------------------------

async function seedInquiries(db: PrismaClient, ctx: SeedContext, rng: Rng): Promise<number> {
  const now = state.now;
  const orders = await db.order.findMany({ where: { id: { startsWith: "demo_order_" }, status: { in: ["SHIPPED", "DELIVERED"] } }, select: { id: true, orderNumber: true }, take: 5, orderBy: { placedAt: "desc" } });
  const specs: Array<{ type: string; status: string; priority: string; subject: string; message: string; withOrder?: boolean; replies?: Array<{ message: string; internal?: boolean }> }> = [
    { type: "ORDER", status: "NEW", priority: "HIGH", subject: "Where is my order?", message: "The tracking page has not updated in three days. Can you check with the courier?", withOrder: true },
    { type: "GENERAL", status: "NEW", priority: "NORMAL", subject: "Bulk order for a wedding", message: "We need 120 personalised keychains as wedding favours by the 20th. Is that possible?" },
    { type: "SELLER", status: "NEW", priority: "NORMAL", subject: "Application status", message: "I applied to sell three weeks ago and have not heard back. My shop is Terracotta Tales." },
    { type: "ORDER", status: "OPEN", priority: "NORMAL", subject: "Change delivery address", message: "I moved house - can the parcel go to my office instead?", withOrder: true },
    { type: "COMPLAINT", status: "OPEN", priority: "HIGH", subject: "Mug print is smudged", message: "The photo on the mug is blurry on one side. Attaching photos.", withOrder: true, replies: [{ message: "Asked the seller for the print file; looks like a low-res upload.", internal: true }] },
    { type: "GENERAL", status: "REPLIED", priority: "LOW", subject: "Do you gift wrap?", message: "Is gift wrapping available on all products?", replies: [{ message: "Hi! Most sellers offer gift wrapping - add a note at checkout and we will pass it on. Hampers come wrapped by default." }] },
    { type: "PARTNERSHIP", status: "REPLIED", priority: "NORMAL", subject: "Corporate gifting tie-up", message: "We are an HR consultancy looking for Diwali gifts for 400 employees.", replies: [{ message: "Thanks for reaching out - our corporate desk set can be engraved with your logo. Sharing a catalogue and bulk pricing by email." }] },
    { type: "ORDER", status: "RESOLVED", priority: "NORMAL", subject: "Invoice with GSTIN", message: "Please add our GSTIN to the invoice.", withOrder: true, replies: [{ message: "Done - the updated invoice is attached to your order page." }, { message: "GSTIN added to the packing slip too.", internal: true }] },
    { type: "GENERAL", status: "RESOLVED", priority: "LOW", subject: "Newsletter unsubscribe", message: "Please remove me from the mailing list.", replies: [{ message: "You have been unsubscribed. Sorry to see you go!" }] },
    { type: "OTHER", status: "SPAM", priority: "LOW", subject: "Increase your website traffic", message: "We can rank your site on page one in 7 days. Reply for a free audit." },
  ];
  let count = 0;
  for (const [index, spec] of specs.entries()) {
    const id = demoId("inquiry", index + 1);
    const createdAt = daysAgo(now, rng.float(0.1, 20));
    const order = spec.withOrder ? orders[index % Math.max(1, orders.length)] : undefined;
    const customer = rng.pick(state.customers);
    await db.contactInquiry.upsert({
      where: { id },
      update: {},
      create: {
        id,
        name: spec.type === "SELLER" ? "Debashish Roy" : customer.fullName ?? "Customer",
        email: spec.type === "SELLER" ? "debashish@terracottatales.example.com" : customer.email,
        phone: customer.phone,
        subject: spec.subject,
        message: order ? `${spec.message} Order ${order.orderNumber}.` : spec.message,
        type: spec.type,
        orderId: order?.id ?? null,
        status: spec.status,
        priority: spec.priority,
        assignedToId: spec.status === "NEW" || spec.status === "SPAM" ? null : ctx.adminUserId,
        resolvedAt: spec.status === "RESOLVED" ? addHours(createdAt, 30) : null,
        createdAt,
      },
    });
    if (spec.replies) {
      await db.inquiryReply.createMany({
        data: spec.replies.map((reply, r) => ({
          id: demoId("ireply", index + 1, r + 1),
          inquiryId: id,
          message: reply.message,
          authorId: ctx.adminUserId,
          isInternal: reply.internal ?? false,
          emailSent: !(reply.internal ?? false),
          createdAt: addHours(createdAt, 4 + r * 6),
        })),
        skipDuplicates: true,
      });
    }
    count += 1;
  }
  return count;
}

async function seedNewsletter(db: PrismaClient, rng: Rng): Promise<number> {
  const now = state.now;
  const rows: Prisma.NewsletterSubscriberCreateManyInput[] = [];
  for (let i = 1; i <= 25; i += 1) {
    const customer = i <= 15 ? state.customers[(i * 2) % state.customers.length] : null;
    const email = customer?.email ?? `reader${i}@example.com`;
    const status = i <= 21 ? "SUBSCRIBED" : i <= 24 ? "UNSUBSCRIBED" : "BOUNCED";
    const subscribedAt = daysAgo(now, rng.float(1, 120));
    rows.push({
      id: demoId("nl", i),
      email,
      name: customer?.fullName ?? null,
      status,
      source: rng.pick(["homepage", "checkout", "popup", "footer"]),
      unsubscribeToken: createHash("sha256").update(`demo-newsletter:${email}`).digest("hex"),
      subscribedAt,
      unsubscribedAt: status === "UNSUBSCRIBED" ? addDays(subscribedAt, rng.float(5, 60)) : null,
      createdAt: subscribedAt,
    });
  }
  const created = await db.newsletterSubscriber.createMany({ data: rows, skipDuplicates: true });
  return created.count;
}

async function seedNotifications(db: PrismaClient, ctx: SeedContext): Promise<number> {
  if (!ctx.adminUserId) return 0;
  const now = state.now;
  const [order, lowStock, outOfStock, rma, refund, review, inquiry, payout, cancelled, failedPayment] = await Promise.all([
    db.order.findFirst({ where: { id: { startsWith: "demo_order_" }, status: "PENDING" }, orderBy: { placedAt: "desc" }, select: { id: true, orderNumber: true, totalPaise: true } }),
    db.inventoryItem.findFirst({ where: { stockState: "LOW_STOCK" }, select: { variant: { select: { name: true, sku: true, product: { select: { title: true } } } } } }),
    db.inventoryItem.findFirst({ where: { stockState: "OUT_OF_STOCK" }, select: { variant: { select: { name: true, sku: true, product: { select: { title: true } } } } } }),
    db.returnRequest.findFirst({ where: { id: { startsWith: "demo_rma_" }, status: "REQUESTED" }, select: { id: true, rmaNumber: true, order: { select: { orderNumber: true } } } }),
    db.refund.findFirst({ where: { id: { startsWith: "demo_refund_" }, status: "PENDING" }, select: { id: true, refundNumber: true, amountPaise: true } }),
    db.review.findFirst({ where: { id: { startsWith: "demo_review_" }, status: "PENDING" }, select: { id: true, product: { select: { title: true } } } }),
    db.contactInquiry.findFirst({ where: { id: { startsWith: "demo_inquiry_" }, status: "NEW" }, select: { id: true, subject: true } }),
    db.sellerPayout.findFirst({ where: { status: "PENDING" }, select: { id: true, payoutNumber: true, netPaise: true, seller: { select: { displayName: true } } } }),
    db.order.findFirst({ where: { id: { startsWith: "demo_order_" }, status: "CANCELLED" }, orderBy: { cancelledAt: "desc" }, select: { id: true, orderNumber: true } }),
    db.orderPayment.findFirst({ where: { status: "FAILED", order: { id: { startsWith: "demo_order_" } } }, orderBy: { createdAt: "desc" }, select: { order: { select: { id: true, orderNumber: true } }, amountPaise: true } }),
  ]);
  const rows: Prisma.NotificationCreateManyInput[] = [];
  const add = (type: string, severity: string, title: string, body: string | null, href: string | null, entityType: string | null, entityId: string | null, hoursAgo: number, read: boolean) =>
    rows.push({ id: demoId("notif", rows.length + 1), userId: ctx.adminUserId as string, type, severity, title, body, entityType, entityId, href, readAt: read ? addHours(now, -hoursAgo + 1) : null, createdAt: addHours(now, -hoursAgo) });

  if (order) add("NEW_ORDER", "info", `New order ${order.orderNumber}`, `${formatInr(order.totalPaise)} · awaiting payment`, `/admin/orders/${order.id}`, "order", order.id, 0.3, false);
  if (lowStock) add("LOW_STOCK", "warning", `Low stock: ${lowStock.variant.product.title} (${lowStock.variant.name})`, "Available stock is at or below the threshold.", `/admin/inventory?q=${encodeURIComponent(lowStock.variant.sku ?? "")}`, "variant", null, 5, false);
  if (outOfStock) add("OUT_OF_STOCK", "critical", `Out of stock: ${outOfStock.variant.product.title} (${outOfStock.variant.name})`, "The variant can no longer be bought.", `/admin/inventory?q=${encodeURIComponent(outOfStock.variant.sku ?? "")}`, "variant", null, 9, false);
  if (rma) add("RETURN_REQUESTED", "warning", `Return ${rma.rmaNumber} requested on ${rma.order.orderNumber}`, "Size issue · refund requested", `/admin/returns/${rma.id}`, "returnRequest", rma.id, 14, false);
  if (refund) add("REFUND_REQUESTED", "warning", `Refund ${refund.refundNumber} awaiting approval`, formatInr(refund.amountPaise), `/admin/refunds/${refund.id}`, "refund", refund.id, 20, true);
  if (review) add("NEW_REVIEW", "info", `New review on ${review.product?.title ?? "a product"}`, "Pending moderation", "/admin/reviews?status=PENDING", "review", review.id, 26, true);
  if (inquiry) add("NEW_INQUIRY", "info", `New inquiry: ${inquiry.subject}`, null, `/admin/inquiries/${inquiry.id}`, "inquiry", inquiry.id, 30, false);
  if (payout) add("PAYOUT_DUE", "info", `Payout ${payout.payoutNumber} ready for approval`, `${payout.seller.displayName} · ${formatInr(payout.netPaise)}`, `/admin/payouts/${payout.id}`, "payout", payout.id, 40, true);
  add("NEW_SELLER", "info", "New seller registration: Terracotta Tales", "Kolkata, West Bengal", `/admin/sellers/${demoId("seller", 6)}`, "seller", demoId("seller", 6), 70, true);
  add("SELLER_APPROVAL_REQUIRED", "warning", "Nakshatra Crafts is awaiting review", "Documents uploaded 9 days ago", `/admin/sellers/${demoId("seller", 7)}`, "seller", demoId("seller", 7), 72, false);
  if (cancelled) add("ORDER_CANCELLED", "warning", `Order ${cancelled.orderNumber} cancelled`, "Customer requested cancellation", `/admin/orders/${cancelled.id}`, "order", cancelled.id, 90, true);
  if (failedPayment) add("PAYMENT_FAILED", "warning", `Payment failed on ${failedPayment.order.orderNumber}`, `${formatInr(failedPayment.amountPaise)} · MOCK`, `/admin/orders/${failedPayment.order.id}`, "order", failedPayment.order.id, 100, true);
  add("SYSTEM", "info", "Demo data loaded", "Every demo row id starts with demo_. Set SEED_DEMO_DATA=false and re-seed for an empty store.", "/admin/settings", null, null, 120, false);

  const created = await db.notification.createMany({ data: rows, skipDuplicates: true });
  return created.count;
}

async function seedOutbox(db: PrismaClient, rng: Rng): Promise<number> {
  const now = state.now;
  const templates = new Map((await db.emailTemplate.findMany({ select: { key: true, subject: true, htmlBody: true, textBody: true } })).map((template) => [template.key, template]));
  const orders = await db.order.findMany({
    where: { id: { startsWith: "demo_order_" }, status: "DELIVERED", customerId: { not: null }, shipments: { some: {} } },
    orderBy: { placedAt: "desc" },
    take: 3,
    select: { id: true, orderNumber: true, totalPaise: true, paymentMethod: true, placedAt: true, shippedAt: true, deliveredAt: true, customer: { select: { email: true, fullName: true } }, shipments: { select: { carrierName: true, trackingNumber: true, trackingUrl: true }, take: 1 }, items: { select: { titleSnapshot: true, quantity: true, lineTotalPaise: true } } },
  });
  const common = { store_name: "DIY Baazar", store_url: "http://localhost:5173", support_email: "hello@diybaazar.local" };
  const rows: Array<{ id: string; templateKey: string; to: { email: string; name: string | null }; vars: Record<string, string>; entityType: string; entityId: string; sentAt: Date }> = [];

  const [first, second, third] = orders;
  if (first?.customer) {
    rows.push({
      id: demoId("outbox", 1),
      templateKey: "order_confirmation",
      to: { email: first.customer.email, name: first.customer.fullName },
      vars: {
        customer_name: first.customer.fullName ?? "there",
        order_id: first.orderNumber,
        order_total: formatInr(first.totalPaise),
        order_items_html: `<table>${first.items.map((item) => `<tr><td>${item.titleSnapshot} × ${item.quantity}</td><td>${formatInr(item.lineTotalPaise)}</td></tr>`).join("")}</table>`,
        order_url: `http://localhost:5173/orders/${first.orderNumber}`,
        payment_method: first.paymentMethod === "COD" ? "Cash on delivery" : "Online",
      },
      entityType: "order",
      entityId: first.id,
      sentAt: addHours(first.placedAt, 0.05),
    });
  }
  if (second?.customer && second.shipments[0]) {
    rows.push({
      id: demoId("outbox", 2),
      templateKey: "order_shipped",
      to: { email: second.customer.email, name: second.customer.fullName },
      vars: {
        customer_name: second.customer.fullName ?? "there",
        order_id: second.orderNumber,
        carrier: second.shipments[0].carrierName ?? "courier",
        tracking_number: second.shipments[0].trackingNumber ?? "",
        tracking_url: second.shipments[0].trackingUrl ?? "",
        eta: "4-6 working days",
        order_url: `http://localhost:5173/orders/${second.orderNumber}`,
      },
      entityType: "order",
      entityId: second.id,
      sentAt: second.shippedAt ?? daysAgo(now, 2),
    });
  }
  if (third?.customer && third.deliveredAt) {
    rows.push({
      id: demoId("outbox", 3),
      templateKey: "order_delivered",
      to: { email: third.customer.email, name: third.customer.fullName },
      vars: { customer_name: third.customer.fullName ?? "there", order_id: third.orderNumber, order_url: `http://localhost:5173/orders/${third.orderNumber}`, review_url: `http://localhost:5173/orders/${third.orderNumber}/review` },
      entityType: "order",
      entityId: third.id,
      sentAt: third.deliveredAt,
    });
  }
  rows.push({
    id: demoId("outbox", 4),
    templateKey: "contact_ack",
    to: { email: state.customers[3]?.email ?? "customer@example.com", name: state.customers[3]?.fullName ?? null },
    vars: { name: state.customers[3]?.fullName ?? "there", subject: "Do you gift wrap?", ticket_id: demoId("inquiry", 6) },
    entityType: "inquiry",
    entityId: demoId("inquiry", 6),
    sentAt: daysAgo(now, 6),
  });
  rows.push({
    id: demoId("outbox", 5),
    templateKey: "newsletter_welcome",
    to: { email: "reader16@example.com", name: null },
    vars: { name: "there", unsubscribe_url: "http://localhost:5173/newsletter/unsubscribe/demo" },
    entityType: "newsletterSubscriber",
    entityId: demoId("nl", 16),
    sentAt: daysAgo(now, 11),
  });
  rows.push({
    id: demoId("outbox", 6),
    templateKey: "seller_approved",
    to: { email: "studio@paperandpine.example.com", name: "Arjun Nair" },
    vars: { seller_name: "Paper & Pine", seller_url: "http://localhost:5173/seller" },
    entityType: "seller",
    entityId: demoId("seller", 5),
    sentAt: daysAgo(now, 146),
  });

  let created = 0;
  for (const row of rows) {
    const template = templates.get(row.templateKey);
    if (!template) continue;
    const rendered = renderTemplate({ subject: template.subject, htmlBody: template.htmlBody, textBody: template.textBody }, { ...common, ...row.vars });
    const exists = await db.emailOutbox.findUnique({ where: { id: row.id }, select: { id: true } });
    if (exists) continue;
    await db.emailOutbox.create({
      data: {
        id: row.id,
        templateKey: row.templateKey,
        toEmail: row.to.email,
        toName: row.to.name,
        subject: rendered.subject,
        htmlBody: rendered.html,
        textBody: rendered.text,
        status: "SENT",
        attempts: 1,
        providerMessageId: `<demo-${row.id}-${rng.int(1000, 9999)}@diybaazar.local>`,
        dedupeKey: `demo:${row.templateKey}:${row.entityType}:${row.entityId}`,
        scheduledAt: row.sentAt,
        sentAt: addHours(row.sentAt, 0.01),
        entityType: row.entityType,
        entityId: row.entityId,
        createdAt: row.sentAt,
      },
    });
    created += 1;
  }
  return created;
}

export async function seedDemoContent(db: PrismaClient, ctx: SeedContext): Promise<void> {
  const rng = createRng("content");
  const banners = await seedBanners(db, ctx);
  const homepage = await seedHomepage(db, ctx);
  const blog = await seedBlog(db, ctx);
  const faqs = await seedFaqs(db);
  const reviews = await seedReviews(db, ctx, rng);
  const inquiries = await seedInquiries(db, ctx, rng);
  const subscribers = await seedNewsletter(db, rng);
  const notifications = await seedNotifications(db, ctx);
  const outbox = await seedOutbox(db, rng);
  ctx.log(
    `banners ${banners}, homepage sections ${homepage.sections} (blocks created ${homepage.blocks}), blog ${blog.categories}/${blog.posts}, faqs ${faqs}, reviews created ${reviews.created} (existing ${reviews.existing}), inquiries ${inquiries}, subscribers created ${subscribers}, notifications created ${notifications}, outbox created ${outbox}`,
  );
}
