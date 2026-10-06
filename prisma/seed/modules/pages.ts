import type { PrismaClient } from "@prisma/client";

import { SYSTEM_CMS_PAGE_SLUGS, type SystemCmsPageSlug } from "../../../src/lib/enums";
import type { SeedContext } from "./context";

/**
 * System CMS pages (E5) - slug locked, cannot be deleted - and the single
 * FooterConfig row. Content is created once and then left to the admin; only
 * the `isSystem`/`template` flags are re-asserted.
 */
type PageSeed = {
  title: string;
  template: "DEFAULT" | "ABOUT" | "CONTACT" | "FAQ" | "POLICY";
  excerpt: string;
  content: string;
  showInFooter?: boolean;
};

const PAGES: Record<SystemCmsPageSlug, PageSeed> = {
  "about-us": {
    title: "About Us",
    template: "ABOUT",
    excerpt: "A marketplace for handmade, DIY and personalised products from Indian artisans.",
    content: `<h2>Made by hand, sold with care</h2>
<p>DIY Baazar is a curated marketplace for handmade and personalised products. Every seller is an independent maker - potters, weavers, painters, jewellers and stationers - and every order goes straight to their workshop.</p>
<h3>What we stand for</h3>
<ul><li>Fair pay for artisans, with transparent commission.</li><li>Personalisation done properly: names, messages, photos and engraving, reviewed before it is made.</li><li>Honest returns when something arrives damaged or not as described.</li></ul>`,
  },
  "contact-us": {
    title: "Contact Us",
    template: "CONTACT",
    excerpt: "Reach the DIY Baazar team.",
    content: `<h2>We are here to help</h2>
<p>For order questions include your order number (it starts with <strong>DB</strong>). Sellers can write to us about onboarding and payouts using the same form.</p>
<p>Customer care hours: Monday to Saturday, 10:00 to 18:00 IST.</p>`,
  },
  faqs: {
    title: "Frequently Asked Questions",
    template: "FAQ",
    excerpt: "Orders, personalisation, shipping, returns and selling.",
    content: `<p>Answers to the questions we hear most often. Can't find yours? Use the contact page and we will reply within one working day.</p>`,
  },
  "privacy-policy": {
    title: "Privacy Policy",
    template: "POLICY",
    excerpt: "How we collect, use and protect your data.",
    content: `<h2>Privacy Policy</h2>
<p>We collect only what is needed to fulfil your order: your name, contact details, delivery address and the personalisation you provide. Photos uploaded for personalised products are stored privately and shared only with the seller making your item.</p>
<h3>Payments</h3><p>Card and UPI details are processed by our payment partners and never stored on our servers.</p>
<h3>Your rights</h3><p>You can ask us to export or delete your account data at any time by contacting customer care.</p>`,
  },
  "terms-and-conditions": {
    title: "Terms and Conditions",
    template: "POLICY",
    excerpt: "The terms that govern purchases on DIY Baazar.",
    content: `<h2>Terms and Conditions</h2>
<p>By placing an order you agree to these terms. Products are sold by independent sellers; DIY Baazar operates the marketplace, processes payments and handles customer care.</p>
<h3>Pricing</h3><p>All prices are in Indian Rupees and include applicable taxes unless stated otherwise. The price shown at checkout is final.</p>
<h3>Personalised items</h3><p>Personalised products are made to order and cannot be cancelled once production has started, except where the item is defective or incorrect.</p>`,
  },
  "return-policy": {
    title: "Return Policy",
    template: "POLICY",
    excerpt: "Returns within 7 days of delivery for eligible items.",
    content: `<h2>Return Policy</h2>
<p>Most items can be returned within <strong>7 days of delivery</strong>. Request a return from your order page; once approved we arrange a pickup.</p>
<h3>Not eligible</h3><ul><li>Personalised or made-to-order items, unless damaged, defective or not as described.</li><li>Items showing signs of use.</li></ul>
<h3>Refunds</h3><p>Refunds are issued to the original payment method, or by bank transfer for cash-on-delivery orders, within 5-7 working days of the returned item passing inspection.</p>`,
  },
  "shipping-policy": {
    title: "Shipping Policy",
    template: "POLICY",
    excerpt: "Delivery timelines, charges and cash on delivery.",
    content: `<h2>Shipping Policy</h2>
<p>We ship across India. Handmade items take 2-5 working days to dispatch; personalised items may take longer and the estimate is shown on the product page.</p>
<h3>Charges</h3><p>Shipping is free above the threshold shown at checkout. Cash on delivery carries a small handling fee.</p>
<h3>Tracking</h3><p>You receive a tracking link by email as soon as the seller hands the parcel to the courier.</p>`,
  },
  "seller-terms": {
    title: "Seller Terms",
    template: "POLICY",
    excerpt: "Commission, payouts and obligations for sellers.",
    content: `<h2>Seller Terms</h2>
<p>Sellers list and fulfil their own products. DIY Baazar collects payment, deducts the applicable commission and pays out the balance on the published payout cycle after the return window closes.</p>
<h3>Commission</h3><p>The commission rate is shown in your seller dashboard and may vary by category.</p>
<h3>Fulfilment</h3><p>Orders must be dispatched within the promised time. Repeated late dispatch or quality complaints may lead to suspension.</p>`,
  },
  "seller-guidelines": {
    title: "Seller Guidelines",
    template: "DEFAULT",
    excerpt: "How to photograph, describe and ship your products.",
    content: `<h2>Seller Guidelines</h2>
<h3>Listings</h3><ul><li>Use natural light and a plain background for the first photo.</li><li>Fill every required attribute so shoppers can filter to your work.</li><li>Describe materials, dimensions and care honestly.</li></ul>
<h3>Personalisation</h3><p>Preview what the customer typed before you make it. If something looks wrong, message customer care before production.</p>
<h3>Packaging</h3><p>Fragile items must be double-boxed. Include a note with your shop name - customers love knowing who made their piece.</p>`,
  },
};

export async function seedPages(db: PrismaClient, ctx: SeedContext) {
  for (const slug of SYSTEM_CMS_PAGE_SLUGS) {
    const page = PAGES[slug];
    await db.cmsPage.upsert({
      where: { slug },
      update: { isSystem: true, template: page.template },
      create: {
        slug,
        title: page.title,
        excerpt: page.excerpt,
        content: page.content,
        template: page.template,
        status: "PUBLISHED",
        publishedAt: new Date(),
        isSystem: true,
        showInFooter: page.showInFooter ?? true,
        metaTitle: `${page.title} | DIY Baazar`,
        metaDescription: page.excerpt,
        authorId: ctx.adminUserId,
      },
    });
  }
  ctx.log(`cms pages: ${SYSTEM_CMS_PAGE_SLUGS.length}`);

  await db.footerConfig.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      brandName: "DIY Baazar",
      brandDescription:
        "A marketplace for handmade, DIY and personalised products from independent Indian artisans.",
      socialLinks: [
        { id: 1, platform: "instagram", url: "https://instagram.com/" },
        { id: 2, platform: "facebook", url: "https://facebook.com/" },
        { id: 3, platform: "youtube", url: "https://youtube.com/" },
      ],
      customerService: {
        heading: "Customer care",
        description: "Monday to Saturday, 10:00 to 18:00 IST.",
        email: "hello@diybaazar.local",
      },
      legalLinks: [
        { id: 1, label: "Privacy Policy", path: "/privacy-policy" },
        { id: 2, label: "Terms and Conditions", path: "/terms-and-conditions" },
      ],
      paymentIcons: ["visa", "mastercard", "rupay", "upi", "cod"],
      appLinks: {},
      copyright: `© ${new Date().getFullYear()} DIY Baazar. All rights reserved.`,
    },
  });
  ctx.log("footer config: 1");
}
