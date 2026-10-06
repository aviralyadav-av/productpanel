import type { PrismaClient } from "@prisma/client";

import { recomputeProductPricing } from "@/features/catalog/pricing";
import type { SeedContext } from "./context";
import { rupees } from "../lib/money";
import { heroBannerSvg, putDemoSvg } from "../lib/placeholders";
import { addDays, daysAgo } from "../lib/rng";
import { categoryBySlug, demoId, mediaId, registerMedia, state, transaction, type DemoCoupon, type DemoPromotion } from "../lib/state";

/**
 * Coupons of every type and derived status (ACTIVE, SCHEDULED, EXPIRED,
 * EXHAUSTED, DISABLED - §4.7) with a fundedBy mix (B3), and three promotions:
 * one running, one scheduled, one ended. Runs BEFORE orders so placed orders
 * can carry real coupon usages and promotion allocations; banners and the
 * homepage live in demo-content (they reference products and sellers).
 *
 * `usageCount` is advanced by the orders module, so re-seeding only asserts
 * presence (`update: {}`) and never resets a counter.
 */
type CouponSpec = {
  code: string;
  name: string;
  description: string;
  type: "PERCENT" | "FIXED" | "FREE_SHIPPING";
  value: number;
  maxDiscount?: number;
  minOrder?: number;
  appliesTo?: "ALL" | "CATEGORIES" | "PRODUCTS" | "SELLERS";
  categorySlugs?: string[];
  productNumbers?: number[];
  sellerNumbers?: number[];
  usageLimit?: number;
  perCustomerLimit?: number;
  startsDaysFromNow?: number;
  endsDaysFromNow?: number;
  isActive?: boolean;
  isPublic?: boolean;
  fundedBy?: "PLATFORM" | "SELLER";
  customerNumbers?: number[];
  firstOrderOnly?: boolean;
};

const COUPONS: CouponSpec[] = [
  { code: "WELCOME10", name: "Welcome 10% off", description: "10% off your order, up to ₹250, on orders above ₹499.", type: "PERCENT", value: 10, maxDiscount: 250, minOrder: 499, startsDaysFromNow: -120 },
  { code: "FLAT100", name: "Flat ₹100 off", description: "₹100 off orders above ₹999.", type: "FIXED", value: 100, minOrder: 999, startsDaysFromNow: -100 },
  { code: "FREESHIP", name: "Free shipping", description: "Free standard shipping on orders above ₹599.", type: "FREE_SHIPPING", value: 0, minOrder: 599, startsDaysFromNow: -100 },
  { code: "JEWEL15", name: "Jewellery 15% off", description: "15% off all jewellery, up to ₹500. Funded by the sellers.", type: "PERCENT", value: 15, maxDiscount: 500, appliesTo: "CATEGORIES", categorySlugs: ["jewellery"], fundedBy: "SELLER", startsDaysFromNow: -90 },
  { code: "MAKER10", name: "Maker's 10%", description: "10% off Kalakriti Studio and Anokhi Threads, funded by the makers.", type: "PERCENT", value: 10, maxDiscount: 400, appliesTo: "SELLERS", sellerNumbers: [1, 2], fundedBy: "SELLER", startsDaysFromNow: -80 },
  { code: "ARTLOVE", name: "₹500 off original art", description: "₹500 off selected original paintings above ₹3,000.", type: "FIXED", value: 500, minOrder: 3000, appliesTo: "PRODUCTS", productNumbers: [65, 66, 68], startsDaysFromNow: -70 },
  { code: "EARLYBIRD", name: "Early bird 20%", description: "20% off for the first five orders, up to ₹300.", type: "PERCENT", value: 20, maxDiscount: 300, usageLimit: 5, startsDaysFromNow: -90 },
  { code: "DIWALI25", name: "Diwali 25%", description: "25% off up to ₹750 on orders above ₹1,499 during the festive week.", type: "PERCENT", value: 25, maxDiscount: 750, minOrder: 1499, startsDaysFromNow: 15, endsDaysFromNow: 35 },
  { code: "SUMMER20", name: "Summer sale 20%", description: "20% off up to ₹400 - ended.", type: "PERCENT", value: 20, maxDiscount: 400, startsDaysFromNow: -150, endsDaysFromNow: -60 },
  { code: "PAUSED50", name: "Paused ₹50 off", description: "Disabled while we review the campaign.", type: "FIXED", value: 50, isActive: false, startsDaysFromNow: -30 },
  { code: "VIP500", name: "VIP ₹500", description: "Private ₹500 off orders above ₹2,500 for VIP customers.", type: "FIXED", value: 500, minOrder: 2500, isPublic: false, customerNumbers: [1, 2], perCustomerLimit: 2, startsDaysFromNow: -60 },
  { code: "FIRSTBUY", name: "First order 15%", description: "15% off your first order, up to ₹300.", type: "PERCENT", value: 15, maxDiscount: 300, firstOrderOnly: true, startsDaysFromNow: -120 },
];

type PromotionSpec = {
  n: number;
  name: string;
  slug: string;
  description: string;
  type: "SALE" | "FLASH_SALE" | "CLEARANCE";
  discountType: "PERCENT" | "FIXED";
  value: number;
  appliesTo: "ALL" | "CATEGORIES" | "PRODUCTS" | "SELLERS";
  categorySlugs?: string[];
  productNumbers?: number[];
  badgeText: string;
  priority: number;
  startsDaysFromNow: number;
  endsDaysFromNow: number;
  fundedBy: "PLATFORM" | "SELLER";
  hue: number;
};

const PROMOTIONS: PromotionSpec[] = [
  { n: 1, name: "Festive Home Sale", slug: "festive-home-sale", description: "10% off everything in Home & Living for the festive season.", type: "SALE", discountType: "PERCENT", value: 10, appliesTo: "CATEGORIES", categorySlugs: ["home-living"], badgeText: "Festive 10% off", priority: 10, startsDaysFromNow: -10, endsDaysFromNow: 20, fundedBy: "PLATFORM", hue: 22 },
  { n: 2, name: "Stationery Flash Sale", slug: "stationery-flash-sale", description: "48-hour flash sale: 20% off all stationery, funded by Paper & Pine.", type: "FLASH_SALE", discountType: "PERCENT", value: 20, appliesTo: "CATEGORIES", categorySlugs: ["stationery"], badgeText: "Flash 20% off", priority: 20, startsDaysFromNow: 7, endsDaysFromNow: 9, fundedBy: "SELLER", hue: 150 },
  { n: 3, name: "Monsoon Bag Clearance", slug: "monsoon-bag-clearance", description: "₹200 off selected bags - ended.", type: "CLEARANCE", discountType: "FIXED", value: 200, appliesTo: "PRODUCTS", productNumbers: [26, 29, 30], badgeText: "₹200 off", priority: 5, startsDaysFromNow: -70, endsDaysFromNow: -25, fundedBy: "PLATFORM", hue: 335 },
];

export async function seedDemoMarketing(db: PrismaClient, ctx: SeedContext): Promise<void> {
  const now = state.now;
  const productId = (n: number) => demoId("prod", n);
  const sellerId = (n: number) => demoId("seller", n);
  const customerId = (n: number) => demoId("cust", n);

  // ---- coupons ------------------------------------------------------------------------
  for (const spec of COUPONS) {
    await db.coupon.upsert({
      where: { code: spec.code },
      update: {},
      create: {
        id: demoId("coupon", spec.code.toLowerCase()),
        code: spec.code,
        name: spec.name,
        description: spec.description,
        type: spec.type,
        value: spec.type === "FIXED" ? rupees(spec.value) : spec.value,
        maxDiscountPaise: spec.maxDiscount ? rupees(spec.maxDiscount) : null,
        minOrderPaise: spec.minOrder ? rupees(spec.minOrder) : null,
        appliesTo: spec.appliesTo ?? "ALL",
        categoryIds: (spec.categorySlugs ?? []).map((slug) => categoryBySlug(slug).id),
        productIds: (spec.productNumbers ?? []).map(productId),
        sellerIds: (spec.sellerNumbers ?? []).map(sellerId),
        excludedProductIds: spec.code === "WELCOME10" ? [productId(68), productId(23)] : [],
        firstOrderOnly: spec.firstOrderOnly ?? false,
        customerIds: (spec.customerNumbers ?? []).map(customerId),
        usageLimit: spec.usageLimit ?? null,
        perCustomerLimit: spec.perCustomerLimit ?? null,
        startsAt: spec.startsDaysFromNow === undefined ? null : addDays(now, spec.startsDaysFromNow),
        endsAt: spec.endsDaysFromNow === undefined ? null : addDays(now, spec.endsDaysFromNow),
        isActive: spec.isActive ?? true,
        isPublic: spec.isPublic ?? true,
        fundedBy: spec.fundedBy ?? "PLATFORM",
        createdById: ctx.adminUserId,
        createdAt: daysAgo(now, Math.max(1, -(spec.startsDaysFromNow ?? -30))),
      },
    });
  }

  // ---- promotions ---------------------------------------------------------------------
  for (const spec of PROMOTIONS) {
    const banner = await putDemoSvg(db, {
      id: demoId("media_promo", spec.n),
      key: `demo/banners/promotion-${spec.slug}.svg`,
      svg: heroBannerSvg({ heading: spec.name, subheading: spec.description, hue: spec.hue, buttonText: "Shop the sale", eyebrow: spec.badgeText }),
      folderId: mediaId("folder:demo/banners"),
      alt: `${spec.name} banner`,
      width: 1600,
      height: 600,
      uploadedById: ctx.adminUserId,
    });
    registerMedia(`promotion:${spec.n}`, banner.id, banner.url);

    const id = demoId("promo", spec.n);
    await db.promotion.upsert({
      where: { id },
      update: {},
      create: {
        id,
        name: spec.name,
        slug: spec.slug,
        description: spec.description,
        type: spec.type,
        discountType: spec.discountType,
        value: spec.discountType === "FIXED" ? rupees(spec.value) : spec.value,
        appliesTo: spec.appliesTo,
        categoryIds: (spec.categorySlugs ?? []).map((slug) => categoryBySlug(slug).id),
        productIds: (spec.productNumbers ?? []).map(productId),
        sellerIds: [],
        badgeText: spec.badgeText,
        bannerMediaId: banner.id,
        priority: spec.priority,
        startsAt: addDays(now, spec.startsDaysFromNow),
        endsAt: addDays(now, spec.endsDaysFromNow),
        isActive: true,
        fundedBy: spec.fundedBy,
        createdAt: daysAgo(now, Math.max(1, -spec.startsDaysFromNow + 3)),
      },
    });
    // A4: the running promotion must be reflected in effective prices.
    await transaction(db, (tx) => recomputeProductPricing(tx, { promotionId: id, now }));
  }

  state.coupons = (await db.coupon.findMany({
    where: { id: { startsWith: "demo_coupon_" }, deletedAt: null },
    select: {
      id: true, code: true, type: true, value: true, maxDiscountPaise: true, minOrderPaise: true, appliesTo: true,
      categoryIds: true, productIds: true, sellerIds: true, excludedProductIds: true, usageLimit: true, usageCount: true,
      startsAt: true, endsAt: true, isActive: true, fundedBy: true, customerIds: true, firstOrderOnly: true,
    },
  })) satisfies DemoCoupon[];
  state.promotions = (await db.promotion.findMany({
    where: { id: { startsWith: "demo_promo_" } },
    select: { id: true, discountType: true, value: true, appliesTo: true, categoryIds: true, productIds: true, sellerIds: true, priority: true, startsAt: true, endsAt: true, isActive: true, fundedBy: true },
  })) satisfies DemoPromotion[];

  const promoted = await db.product.count({ where: { activePromotionId: { not: null } } });
  ctx.log(`coupons: ${state.coupons.length}, promotions: ${state.promotions.length} (products carrying a live promotion: ${promoted})`);
}
