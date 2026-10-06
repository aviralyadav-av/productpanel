import "dotenv/config";

import { db } from "@/lib/db";

import { loadCartLines } from "@/features/coupons/cart-lines";
import { validateCouponForCart } from "@/features/coupons/service";

/**
 * Rule-engine check against the REAL seeded database:
 *
 *   npx tsx src/features/coupons/__checks__/coupon-check.ts
 *
 * Builds a cart from published demo products (skipping the two products
 * WELCOME10 excludes), then asserts that WELCOME10 yields a 10% discount
 * capped at ₹250 and that EARLYBIRD (usageLimit 5, fully redeemed by the demo
 * orders) is rejected as EXHAUSTED. Also proves the uniform-failure path for an
 * unknown code and the minimum-order rule for FLAT100.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

async function main(): Promise<void> {
  const welcome = await db.coupon.findFirst({ where: { code: "WELCOME10", deletedAt: null } });
  assert(welcome, "WELCOME10 exists in the seed");

  const products = await db.product.findMany({
    where: {
      id: { startsWith: "demo_prod_", notIn: welcome.excludedProductIds },
      status: "PUBLISHED",
      deletedAt: null,
      OR: [{ sellerId: null }, { seller: { status: "ACTIVE", deletedAt: null } }],
      pricePaise: { gte: 30_000 },
    },
    orderBy: { pricePaise: "desc" },
    take: 3,
    select: { id: true, title: true, pricePaise: true, variants: { where: { isActive: true, deletedAt: null }, take: 1, select: { id: true } } },
  });
  assert(products.length >= 2, "at least two published demo products to build a cart from");

  const items = products.map((product) => ({ productId: product.id, variantId: product.variants[0]?.id ?? null, quantity: 1 }));
  const cart = await loadCartLines(items);
  assert(cart.missing.length === 0, `every cart item resolved (missing: ${JSON.stringify(cart.missing)})`);
  assert(cart.lines.length === items.length, "one line per item");
  console.log(`cart: ${cart.lines.length} lines, subtotal ₹${(cart.subtotalPaise / 100).toFixed(2)}`);

  // --- WELCOME10: 10% up to ₹250 on orders above ₹499 --------------------------------
  const ok = await validateCouponForCart({ code: "welcome10", lines: cart.lines, subtotalPaise: cart.subtotalPaise });
  assert(ok.ok, `WELCOME10 applies (${!ok.ok ? `${ok.reason}: ${ok.message}` : ""})`);
  assert(ok.discountPaise > 0, "WELCOME10 produced a discount");
  const expected = Math.min(Math.round(cart.subtotalPaise * 0.1), welcome.maxDiscountPaise ?? Infinity);
  assert(ok.discountPaise === expected, `WELCOME10 discount ${ok.discountPaise} equals 10% capped (${expected})`);
  assert(ok.perLine.reduce((sum, line) => sum + line.discountPaise, 0) === ok.discountPaise, "per-line allocation sums to the total");
  assert(ok.coupon.fundedBy === "PLATFORM", "WELCOME10 is platform-funded");
  console.log(`WELCOME10 -> ₹${(ok.discountPaise / 100).toFixed(2)} across ${ok.perLine.filter((l) => l.discountPaise > 0).length} lines`);

  // --- EARLYBIRD: usage limit reached ------------------------------------------------
  const early = await db.coupon.findFirst({ where: { code: "EARLYBIRD", deletedAt: null }, select: { usageCount: true, usageLimit: true } });
  assert(early && early.usageLimit !== null && early.usageCount >= early.usageLimit, "EARLYBIRD is exhausted in the seed");
  const exhausted = await validateCouponForCart({ code: "EARLYBIRD", lines: cart.lines, subtotalPaise: cart.subtotalPaise });
  assert(!exhausted.ok && exhausted.reason === "EXHAUSTED", `EARLYBIRD rejected as EXHAUSTED (got ${exhausted.ok ? "ok" : exhausted.reason})`);
  console.log(`EARLYBIRD -> ${exhausted.reason}: ${exhausted.message}`);

  // --- Unknown code + minimum order --------------------------------------------------
  const unknown = await validateCouponForCart({ code: "NOPE-NOT-A-CODE", lines: cart.lines });
  assert(!unknown.ok && unknown.reason === "NOT_FOUND", "unknown code is NOT_FOUND");

  const cheap = cart.lines.slice(0, 1).map((line) => ({ ...line, unitPricePaise: 10_000, promotionDiscountPaise: 0 }));
  const flat = await validateCouponForCart({ code: "FLAT100", lines: cheap });
  assert(!flat.ok && flat.reason === "MIN_ORDER_NOT_MET", `FLAT100 below ₹999 is MIN_ORDER_NOT_MET (got ${flat.ok ? "ok" : flat.reason})`);

  console.log("coupon-check: all assertions passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
