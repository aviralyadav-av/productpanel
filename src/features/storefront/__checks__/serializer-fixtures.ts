/**
 * Pure serializer check (no database): feeds typed fixture rows through the
 * public serialisers and asserts the money rules (A4/A10), stock aggregation,
 * sanitisation (D12), link availability and the D11 denylist on the output.
 *
 * Exists because the seed may not contain products yet when the read API
 * lands; the query paths are covered by denylist-scan.ts once it does.
 *
 *   node --env-file=.env --import tsx src/features/storefront/__checks__/serializer-fixtures.ts
 */

import {
  serializeBanner,
  serializeFooter,
  serializeNavItem,
  serializeProductDetail,
  type BannerRow,
  type FooterRow,
  type MediaRow,
  type NavItemRow,
  type ProductDetailRow,
} from "@/lib/serializers/public";

const failures: string[] = [];
function expect(condition: unknown, message: string): void {
  if (!condition) failures.push(message);
}

const DENY = new Set([
  "costPaise", "passwordHash", "email", "phone", "pan", "gstin", "accountNumber", "ipAddress", "userAgent",
  "rawPayload", "isInternal", "draftPayload", "commissionPaise", "sellerPayablePaise", "notes", "customerId",
]);
function scan(value: unknown, path: string): void {
  if (value instanceof Date) failures.push(`${path} is a Date`);
  if (value === undefined) failures.push(`${path} is undefined`);
  if (Array.isArray(value)) value.forEach((item, index) => scan(item, `${path}[${index}]`));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (DENY.has(key) || /(Enc|Hash)$/.test(key)) failures.push(`${path}.${key} is denylisted`);
      scan(child, `${path}.${key}`);
    }
  }
}

const now = new Date("2026-09-08T10:00:00.000Z");
const media = (name: string): MediaRow => ({ url: `/media/products/2026/09/${name} (1).jpg`, alt: name, width: 1200, height: 1200 });

const detailRow: ProductDetailRow = {
  id: "p1",
  slug: "blue-mug",
  title: "Blue mug",
  shortDescription: "Stoneware, 300 ml",
  brand: null,
  isFeatured: true,
  isNewArrival: true,
  isBestseller: false,
  isTrending: false,
  isCustomizable: true,
  ratingAvg: 4.5,
  reviewCount: 2,
  createdAt: now,
  publishedAt: now,
  pricePaise: 79900,
  salePricePaise: 64900,
  saleStartsAt: null,
  saleEndsAt: null,
  effectivePricePaise: 64900,
  minVariantPricePaise: 64900,
  maxVariantPricePaise: 89900,
  promotionPricePaise: null,
  activePromotion: { discountType: "FIXED", value: 10000, badgeText: "Festive", endsAt: new Date("2026-11-01T00:00:00.000Z") },
  status: "PUBLISHED",
  deletedAt: null,
  description: '<p onclick="x()">Hi <script>alert(1)</script><strong>bold</strong> <img src="https://evil.example/p.gif"></p>',
  videoUrl: null,
  minOrderQty: 1,
  maxOrderQty: null,
  customFields: { Care: "Hand wash" },
  metaTitle: null,
  metaDescription: null,
  metaKeywords: null,
  canonicalUrl: null,
  categoryId: "c1",
  video: null,
  ogImage: null,
  images: [
    { id: "i1", alt: "Front", isPrimary: true, media: media("front") },
    { id: "i2", alt: null, isPrimary: false, media: media("side") },
  ],
  tags: [{ slug: "diwali", name: "Diwali" }],
  seller: {
    slug: "kala-pottery",
    displayName: "Kala Pottery",
    description: "Small-batch stoneware.",
    city: "Jaipur",
    state: "Rajasthan",
    ratingAvg: 4.7,
    reviewCount: 10,
    createdAt: now,
    logo: null,
    banner: null,
    status: "ACTIVE",
    deletedAt: null,
  },
  category: { id: "c1", slug: "mugs", name: "Mugs", path: "/home-living/kitchen/mugs", isActive: true, description: null, image: null },
  attributeValues: [
    { attributeId: "a-material", textValue: null, numberValue: null, boolValue: null, value: { value: "stoneware", label: "Stoneware", position: 0 } },
    { attributeId: "a-capacity", textValue: null, numberValue: 300, boolValue: null, value: null },
  ],
  variants: [
    {
      id: "v1",
      name: "Blue / Large",
      sku: "MUG-L",
      pricePaise: null,
      salePricePaise: null,
      isDefault: true,
      inventory: { stockState: "LOW_STOCK" },
      attributeValues: [
        { attribute: { code: "size", name: "Size", position: 2 }, value: { value: "l", label: "Large", colorHex: null, position: 1 } },
        { attribute: { code: "color", name: "Colour", position: 1 }, value: { value: "blue", label: "Blue", colorHex: "#1e40af", position: 0 } },
      ],
      images: [],
    },
    {
      id: "v2",
      name: "Blue / XL",
      sku: "MUG-XL",
      pricePaise: 89900,
      salePricePaise: null,
      isDefault: false,
      inventory: { stockState: "OUT_OF_STOCK" },
      attributeValues: [
        { attribute: { code: "size", name: "Size", position: 2 }, value: { value: "xl", label: "XL", colorHex: null, position: 2 } },
        { attribute: { code: "color", name: "Colour", position: 1 }, value: { value: "blue", label: "Blue", colorHex: "#1e40af", position: 0 } },
      ],
      images: [],
    },
  ],
  customizationOptions: [
    {
      id: "o1",
      type: "DESIGN_SELECT",
      label: "Design",
      helpText: null,
      placeholder: null,
      isRequired: true,
      minLength: null,
      maxLength: null,
      maxFiles: null,
      allowedMimeTypes: [],
      choices: [{ value: "floral", label: "Floral", priceDeltaPaise: 5000, imageUrl: "/media/designs/floral.png" }],
      priceDeltaPaise: 2500,
    },
  ],
};

const detail = serializeProductDetail(detailRow, {
  specAttributes: [
    { id: "a-material", code: "material", name: "Material", unit: null, inputType: "SELECT", position: 1 },
    { id: "a-capacity", code: "capacity", name: "Capacity", unit: "ml", inputType: "NUMBER", position: 2 },
  ],
  breadcrumb: [
    { slug: "home-living", name: "Home & Living", path: "/home-living" },
    { slug: "kitchen", name: "Kitchen", path: "/home-living/kitchen" },
    { slug: "mugs", name: "Mugs", path: "/home-living/kitchen/mugs" },
  ],
  related: [],
  reviewBuckets: [{ rating: 5, count: 1 }, { rating: 4, count: 1 }],
  now,
});

// Money (rupees, A4/A10)
expect(detail.price === 799 && detail.salePrice === 649 && detail.effectivePrice === 649, `pricing: ${detail.price}/${detail.salePrice}/${detail.effectivePrice}`);
expect(detail.priceFrom === 649 && detail.priceTo === 899, `priceFrom/To: ${detail.priceFrom}/${detail.priceTo}`);
expect(detail.discountPercent === 19, `discountPercent ${detail.discountPercent}`);
expect(detail.promotionBadge === null, "promotion did not win, badge must be null");
expect(detail.badges.join(",") === "sale,new,customizable", `badges ${detail.badges.join(",")}`);
// Variants: inherit list+sale; own price gets the FIXED ₹100 promotion floor
expect(detail.variants[0].price === 799 && detail.variants[0].salePrice === 649 && detail.variants[0].effectivePrice === 649, "variant 1 inherits product pricing");
expect(detail.variants[1].price === 899 && detail.variants[1].salePrice === null && detail.variants[1].effectivePrice === 799, `variant 2 promotion: ${JSON.stringify(detail.variants[1])}`);
expect(detail.variants[0].options[0].attributeCode === "color", "variant options ordered by attribute position");
expect(detail.variantAxes.map((axis) => axis.code).join(",") === "color,size", "variant axes ordered");
expect(detail.variantAxes[1].values.map((value) => value.value).join(",") === "l,xl", "axis values ordered by position");
// Stock
expect(detail.stockState === "low" && detail.variants[1].stockState === "out", "stock aggregation picks the best variant state");
// Sanitisation (D12)
expect(!detail.description.includes("<script") && !detail.description.includes("onclick") && !detail.description.includes("evil.example"), `description not sanitised: ${detail.description}`);
expect(detail.description.includes("<strong>bold</strong>"), "sanitiser keeps allowed markup");
// Media absolute + encoded
expect(detail.image?.url.startsWith("http") && detail.image.url.includes("%20(1).jpg"), `image url ${detail.image?.url}`);
expect(detail.images.length === 2 && detail.images[0].isPrimary, "gallery keeps order and primary flag");
// Specs + custom fields
expect(JSON.stringify(detail.specs) === JSON.stringify([
  { code: "material", name: "Material", unit: null, values: ["Stoneware"] },
  { code: "capacity", name: "Capacity", unit: "ml", values: ["300"] },
  { code: "Care", name: "Care", unit: null, values: ["Hand wash"] },
]), `specs ${JSON.stringify(detail.specs)}`);
// Customisation surcharge in rupees, choice image absolute
expect(detail.customizationOptions[0].priceDelta === 25 && detail.customizationOptions[0].choices[0].priceDelta === 50, "customisation deltas in rupees");
expect(detail.customizationOptions[0].choices[0].image?.startsWith("http") === true, "choice image absolute");
// Seller card = D11 field list only
expect(detail.seller !== null && Object.keys(detail.seller).sort().join(",") === "banner,city,description,displayName,logo,memberSince,ratingAvg,reviewCount,slug,state,url", `seller keys ${detail.seller && Object.keys(detail.seller).join(",")}`);
// Breadcrumb + reviews summary + dates
expect(detail.breadcrumb.length === 3 && detail.breadcrumb[2].url === "/c/home-living/kitchen/mugs", "breadcrumb urls");
expect(detail.reviewsSummary.average === 4.5 && detail.reviewsSummary.count === 2 && detail.reviewsSummary.distribution["5"] === 1, "reviews summary");
expect(detail.createdAt === "2026-09-08T10:00:00.000Z", "dates are ISO strings");

// Banner: link to an inactive category resolves to url null
const bannerRow: BannerRow = {
  id: "b1", title: "Sale", subtitle: null, placement: "HOME_HERO", altText: "Sale banner", linkType: "CATEGORY", linkUrl: null,
  buttonText: "Shop", textColor: null, bgColor: null, position: 0, startsAt: null, endsAt: null,
  media: media("hero"), mobileMedia: null, category: { path: "/gifts", isActive: false }, product: null, page: null,
};
const banner = serializeBanner(bannerRow);
expect(banner.link.type === "CATEGORY" && banner.link.url === null, "inactive category link → url null");
expect(serializeBanner({ ...bannerRow, category: { path: "/gifts", isActive: true } }).link.url === "/c/gifts", "active category link → /c/gifts");
expect(serializeBanner({ ...bannerRow, linkType: "URL", linkUrl: "javascript:alert(1)" }).link.url === null, "javascript: URL dropped");

// Navigation: unpublished product target → isAvailable false
const navRow: NavItemRow = {
  id: "n1", parentId: null, label: "Mug", type: "PRODUCT", url: null, iconName: null, badgeText: null, openInNewTab: false, isMegaMenu: false, position: 0,
  category: null, product: { slug: "blue-mug", status: "DRAFT", deletedAt: null, seller: null }, page: null,
};
const nav = serializeNavItem(navRow, []);
expect(nav.isAvailable === false && nav.url === null, "draft product nav item unavailable");
expect(serializeNavItem({ ...navRow, product: { ...navRow.product!, status: "PUBLISHED" } }, []).url === "/p/blue-mug", "published product nav item → /p/slug");
expect(serializeNavItem({ ...navRow, type: "HOME", product: null }, []).url === "/", "HOME → /");

// Footer: customerService.email becomes supportEmail; menus pass through
const footerRow: FooterRow = {
  brandName: "DIY Baazar", brandDescription: "Handmade.", copyright: "© 2026", paymentIcons: ["upi"], updatedAt: now,
  socialLinks: [{ id: 1, platform: "instagram", url: "https://instagram.com/x" }, { id: 2, platform: "bad", url: "javascript:1" }],
  customerService: { heading: "Help", description: "Mon–Sat", email: "help@example.com" },
  legalLinks: [{ id: 1, label: "Privacy", path: "/pages/privacy-policy" }],
  appLinks: { playStore: "https://play.google.com/x" },
};
const footer = serializeFooter(footerRow, { instagram: "https://instagram.com/x", facebook: "" }, []);
expect(footer.customerService.supportEmail === "help@example.com", "supportEmail carried");
expect(footer.socialLinks.length === 1, "unsafe social link dropped");
expect(footer.appLinks.playStore !== null && footer.appLinks.appStore === null, "app links");

for (const [name, value] of Object.entries({ detail, banner, nav, footer })) scan(value, name);

if (failures.length > 0) {
  console.error(`SERIALIZER FIXTURES FAILED (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("SERIALIZER FIXTURES PASSED");
  console.log("sample card:", JSON.stringify({ ...detail, description: "…", images: `[${detail.images.length}]`, variants: `[${detail.variants.length}]`, specs: detail.specs, customizationOptions: `[${detail.customizationOptions.length}]`, related: "[]" }));
}
