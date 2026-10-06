import type { Prisma, PrismaClient } from "@prisma/client";

import type { SeedContext } from "./context";
import { createRng, daysAgo } from "../lib/rng";
import { demoId, INDIAN_CITIES, state, STREETS, type DemoCustomer } from "../lib/state";

/**
 * Forty demo customers (blueprint §12, §4.5): saved addresses (SHIPPING plus
 * some BILLING/BOTH), three BLOCKED accounts, a marketing-consent mix and
 * wishlists that point at real default variants (F4: variantId required).
 * Order counters (C7) are filled in by the returns/finance module once the
 * orders exist.
 */
const FIRST_NAMES = [
  "Priya", "Rohan", "Ananya", "Vikram", "Sneha", "Arjun", "Kavya", "Aditya", "Neha", "Rahul",
  "Ishita", "Karan", "Meera", "Siddharth", "Pooja", "Nikhil", "Divya", "Manish", "Riya", "Amit",
  "Shreya", "Varun", "Aishwarya", "Deepak", "Nandini", "Sanjay", "Tanvi", "Harsh", "Lakshmi", "Gaurav",
  "Ritika", "Suresh", "Bhavna", "Kunal", "Sakshi", "Ravi", "Anjali", "Mohit", "Farah", "Imran",
];
const LAST_NAMES = [
  "Sharma", "Verma", "Iyer", "Singh", "Kulkarni", "Mehta", "Nair", "Reddy", "Gupta", "Das",
  "Banerjee", "Malhotra", "Pillai", "Joshi", "Chauhan", "Bose", "Menon", "Agarwal", "Kapoor", "Rao",
  "Deshpande", "Saxena", "Krishnan", "Bhatt", "Mukherjee", "Yadav", "Shetty", "Jain", "Nambiar", "Dubey",
  "Patel", "Chatterjee", "Trivedi", "Sinha", "Hegde", "Mishra", "Ghosh", "Kaur", "Sheikh", "Khan",
];
const DOMAINS = ["example.com", "example.in", "mail.example.org"];

export async function seedDemoCustomers(db: PrismaClient, ctx: SeedContext): Promise<void> {
  const rng = createRng("customers");
  const now = state.now;
  let addresses = 0;
  let wishlistItems = 0;

  const wishlistPool = state.products.filter((product) => product.status === "PUBLISHED" && product.variants.some((variant) => variant.isActive));

  for (let n = 1; n <= 40; n += 1) {
    const id = demoId("cust", n);
    const firstName = FIRST_NAMES[n - 1];
    const lastName = LAST_NAMES[(n * 7) % LAST_NAMES.length];
    const fullName = `${firstName} ${lastName}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${n > 20 ? n : ""}@${DOMAINS[n % DOMAINS.length]}`;
    const phone = `+91${9000000000 + n * 1234567 + 100000}`.slice(0, 13);
    const createdAt = daysAgo(now, rng.int(5, 300));
    const blocked = n >= 38;
    const home = INDIAN_CITIES[(n * 3) % INDIAN_CITIES.length];

    await db.customer.upsert({
      where: { id },
      update: {},
      create: {
        id,
        email,
        fullName,
        phone,
        status: blocked ? "BLOCKED" : "ACTIVE",
        emailVerifiedAt: rng.chance(0.85) ? createdAt : null,
        acceptsMarketing: rng.chance(0.6),
        notes: blocked ? "Blocked after three refused COD deliveries in one month." : n <= 2 ? "Early supporter - VIP coupon holder." : null,
        tags: n <= 2 ? ["vip"] : blocked ? ["cod-risk"] : [],
        lastLoginAt: daysAgo(now, rng.int(0, 30)),
        createdAt,
      },
    });

    // ---- addresses ------------------------------------------------------------------
    const addressRows: Prisma.AddressCreateManyInput[] = [
      {
        id: demoId("addr", n, 1),
        customerId: id,
        label: "Home",
        fullName,
        phone,
        line1: `${rng.int(1, 240)}, ${rng.pick(STREETS)}`,
        line2: rng.chance(0.5) ? `Flat ${rng.int(101, 904)}, ${rng.pick(["Shanti Apartments", "Green Meadows", "Lake Residency", "Sunrise Towers"])}` : null,
        landmark: rng.chance(0.4) ? rng.pick(["Near the metro station", "Opposite the post office", "Behind City Mall", "Next to the temple"]) : null,
        city: home.city,
        state: home.state,
        pinCode: home.pin,
        country: "IN",
        type: rng.chance(0.6) ? "BOTH" : "SHIPPING",
        isDefault: true,
        createdAt,
      },
    ];
    if (rng.chance(0.35)) {
      const other = INDIAN_CITIES[(n * 5 + 7) % INDIAN_CITIES.length];
      const secondIsBilling = addressRows[0].type === "SHIPPING";
      addressRows.push({
        id: demoId("addr", n, 2),
        customerId: id,
        label: secondIsBilling ? "Billing" : "Office",
        fullName,
        phone,
        line1: `${rng.int(1, 120)}, ${rng.pick(STREETS)}`,
        line2: secondIsBilling ? null : `${rng.int(2, 9)}th Floor, ${rng.pick(["Tech Park", "Trade Centre", "Business Bay"])}`,
        city: other.city,
        state: other.state,
        pinCode: other.pin,
        country: "IN",
        type: secondIsBilling ? "BILLING" : "SHIPPING",
        isDefault: false,
        createdAt,
      });
    }
    const created = await db.address.createMany({ data: addressRows, skipDuplicates: true });
    addresses += created.count;

    // ---- wishlist -------------------------------------------------------------------
    if (n % 5 !== 0 && wishlistPool.length > 0) {
      await db.wishlist.upsert({ where: { customerId: id }, update: {}, create: { id: demoId("wishlist", n), customerId: id, createdAt } });
      const picks = rng.sample(wishlistPool, rng.int(1, 4));
      const rows: Prisma.WishlistItemCreateManyInput[] = picks.map((product, index) => {
        const variant = product.variants.find((item) => item.isDefault && item.isActive) ?? product.variants.find((item) => item.isActive)!;
        return {
          id: demoId("wishitem", n, index + 1),
          wishlistId: demoId("wishlist", n),
          productId: product.id,
          variantId: variant.id,
          createdAt: daysAgo(now, rng.int(0, 40)),
        };
      });
      const inserted = await db.wishlistItem.createMany({ data: rows, skipDuplicates: true });
      wishlistItems += inserted.count;
    }
  }

  const rows = await db.customer.findMany({
    where: { id: { startsWith: "demo_cust_" } },
    orderBy: { id: "asc" },
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      status: true,
      createdAt: true,
      addresses: {
        orderBy: { isDefault: "desc" },
        select: { id: true, fullName: true, phone: true, line1: true, line2: true, landmark: true, city: true, state: true, pinCode: true, type: true, isDefault: true },
      },
    },
  });
  state.customers = rows satisfies DemoCustomer[];
  ctx.log(`customers: ${rows.length} (addresses created ${addresses}, wishlist items created ${wishlistItems})`);
}
