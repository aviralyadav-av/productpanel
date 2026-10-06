import { db } from "@/lib/db";

import { checkPincode, loadQuoteSettings, priceQuoteItems, quoteShipping, resolveZoneForPincode } from "@/features/shipping/service";

/**
 * End-to-end check against the REAL database:
 *
 *   node --env-file=.env --import tsx src/features/shipping/__checks__/quote-check.ts
 *
 * Quotes a demo product (demo_prod_007, 180 g) to 110001 (Delhi) and to
 * 999999 (no such place), once ONLINE and once COD, and prints what checkout
 * would see. Asserts the invariants that matter: the default zone catches
 * unknown pincodes, B7 zeroes the rate above the threshold while the COD fee
 * survives, and a COD checkout never lists a rate without COD.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`);
}

async function main() {
  const settings = await loadQuoteSettings();
  console.log("settings", settings);

  const product = await db.product.findUnique({ where: { id: "demo_prod_007" }, select: { id: true, title: true, weightGrams: true, effectivePricePaise: true } });
  assert(product, "demo_prod_007 exists (seed the demo data first)");
  console.log("product", product);

  for (const pin of ["110001", "999999"]) {
    const check = await checkPincode(pin);
    const resolved = await resolveZoneForPincode(pin);
    console.log(`\n== ${pin}`, { serviceable: check.serviceable, cod: check.codAvailable, days: check.estimatedDays, zone: check.zone?.name, matchedBy: resolved.matchedBy, known: check.known });

    for (const paymentMethod of ["ONLINE", "COD"] as const) {
      for (const quantity of [1, 10]) {
        const priced = await priceQuoteItems([{ productId: product.id, quantity }]);
        const quote = await quoteShipping({ pinCode: pin, items: priced.items, discountedSubtotalPaise: priced.subtotalPaise, paymentMethod });
        console.log(`  ${paymentMethod} x${quantity} subtotal=${priced.subtotalPaise} weight=${quote.weightGrams}g serviceable=${quote.serviceable} default=${quote.defaultRateId}`);
        for (const rate of quote.rates) {
          console.log(`    - ${rate.name} [${rate.method}] pay=${rate.ratePaise} base=${rate.baseRatePaise} free=${rate.isFree} cod=${rate.codAvailable} codFee=${rate.codFeePaise} eta=${rate.estimatedDaysMin}-${rate.estimatedDaysMax}d`);
        }
        if (quote.reasons.length) console.log(`    reasons: ${quote.reasons.join(", ")}`);

        if (quote.zone) {
          assert(quote.pincode.zone?.id === quote.zone.id, "checkPincode and quoteShipping agree on the zone");
        }
        if (paymentMethod === "COD") {
          assert(quote.rates.every((rate) => rate.codAvailable), "COD checkout lists only COD-capable rates");
        }
        for (const rate of quote.rates) {
          const threshold = settings.freeAbovePaise;
          if (threshold && priced.subtotalPaise >= threshold) assert(rate.ratePaise === 0 && rate.isFree, `${rate.name} is free above the threshold (B7)`);
          else assert(rate.ratePaise === rate.baseRatePaise, `${rate.name} charges its base rate below the threshold`);
          if (rate.codAvailable) assert(rate.codFeePaise > 0, "COD fee survives free shipping (B7)");
        }
      }
    }
  }

  const defaultZone = await db.shippingZone.findFirst({ where: { isDefault: true } });
  assert(defaultZone, "a default zone exists");
  const unknown = await resolveZoneForPincode("999999");
  assert(unknown.zone?.id === defaultZone.id && unknown.matchedBy === "default", "an unknown pincode falls back to the default zone");

  console.log("\nquote-check: OK");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
