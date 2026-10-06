import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_ITEM_WEIGHT_GRAMS,
  estimatedDelivery,
  pickDefaultRate,
  resolveZoneFromCandidates,
  selectRates,
  sumWeightGrams,
  type QuoteSettings,
  type RateCandidate,
  type ZoneCandidate,
} from "./resolution";
import { buildTrackingUrl, trackingTemplateProblem } from "./tracking";

/** Run with: node --import tsx --test src/features/shipping/resolution.test.ts */

const zone = (partial: Partial<ZoneCandidate> & { id: string }): ZoneCandidate => ({
  name: partial.id,
  states: [],
  pincodePrefixes: [],
  isDefault: false,
  isActive: true,
  ...partial,
});

const ZONES: ZoneCandidate[] = [
  zone({ id: "delhi_city", pincodePrefixes: ["1100"] }),
  zone({ id: "north", pincodePrefixes: ["11", "12"], states: ["HR", "PB"] }),
  zone({ id: "west", states: ["MH", "GJ"] }),
  zone({ id: "inactive_south", pincodePrefixes: ["56"], states: ["KA"], isActive: false }),
  zone({ id: "all_india", isDefault: true }),
];

describe("resolveZoneFromCandidates priority", () => {
  it("1. the row's assigned zone wins over everything", () => {
    const result = resolveZoneFromCandidates({ pincode: "110001", assignedZoneId: "west" }, ZONES);
    assert.equal(result.zone?.id, "west");
    assert.equal(result.matchedBy, "assigned");
  });

  it("2. the longest prefix beats a shorter one", () => {
    assert.equal(resolveZoneFromCandidates({ pincode: "110001" }, ZONES).zone?.id, "delhi_city");
    assert.equal(resolveZoneFromCandidates({ pincode: "122001" }, ZONES).zone?.id, "north");
    assert.equal(resolveZoneFromCandidates({ pincode: "122001" }, ZONES).matchedBy, "prefix");
  });

  it("3. a state match is used when no prefix matches (case-insensitive)", () => {
    const result = resolveZoneFromCandidates({ pincode: "400001", stateCode: "mh" }, ZONES);
    assert.equal(result.zone?.id, "west");
    assert.equal(result.matchedBy, "state");
  });

  it("4. the default zone is the fallback", () => {
    const result = resolveZoneFromCandidates({ pincode: "999999" }, ZONES);
    assert.equal(result.zone?.id, "all_india");
    assert.equal(result.matchedBy, "default");
  });

  it("inactive zones never match, even by prefix, state or assignment", () => {
    assert.equal(resolveZoneFromCandidates({ pincode: "560001", stateCode: "KA", assignedZoneId: "inactive_south" }, ZONES).zone?.id, "all_india");
  });

  it("returns null when nothing matches and no default exists", () => {
    const result = resolveZoneFromCandidates({ pincode: "999999" }, ZONES.filter((candidate) => !candidate.isDefault));
    assert.equal(result.zone, null);
    assert.equal(result.matchedBy, null);
  });
});

describe("sumWeightGrams", () => {
  it("multiplies by quantity and defaults missing weights to 500 g", () => {
    assert.equal(sumWeightGrams([{ quantity: 2, weightGrams: 180 }, { quantity: 3 }, { quantity: 1, weightGrams: null }]), 360 + 4 * DEFAULT_ITEM_WEIGHT_GRAMS);
  });
});

const rate = (partial: Partial<RateCandidate> & { id: string }): RateCandidate => ({
  name: partial.id,
  method: "STANDARD",
  ratePaise: 7900,
  freeAbovePaise: null,
  minWeightGrams: null,
  maxWeightGrams: null,
  minOrderPaise: null,
  maxOrderPaise: null,
  codAvailable: true,
  codFeePaise: 0,
  estimatedDaysMin: 3,
  estimatedDaysMax: 7,
  isActive: true,
  position: 0,
  ...partial,
});

const SETTINGS: QuoteSettings = { freeAbovePaise: 99900, codEnabled: true, codFeePaise: 4900, codMaxPaise: 1000000 };
const NOW = new Date("2026-09-08T06:00:00.000Z");

describe("selectRates quote maths", () => {
  const rates = [
    rate({ id: "standard", ratePaise: 7900, position: 0 }),
    rate({ id: "express", method: "EXPRESS", ratePaise: 19900, codAvailable: false, estimatedDaysMin: 2, estimatedDaysMax: 4, position: 1 }),
    rate({ id: "heavy", ratePaise: 24900, minWeightGrams: 5001, position: 2 }),
    rate({ id: "light_only", ratePaise: 4900, maxWeightGrams: 500, position: 3, isActive: false }),
    rate({ id: "big_orders", ratePaise: 0, minOrderPaise: 500000, position: 4 }),
  ];

  it("applies weight and order bounds, skips inactive rates and records reasons", () => {
    const result = selectRates({ rates, weightGrams: 1000, discountedSubtotalPaise: 50000, paymentMethod: "ONLINE", pincodeCodAvailable: true, settings: SETTINGS, now: NOW });
    assert.deepEqual(result.rates.map((r) => r.rateId), ["standard", "express"]);
    assert.deepEqual(result.reasons, ["heavy:weight_out_of_bounds", "light_only:inactive", "big_orders:order_value_out_of_bounds"]);
    assert.equal(result.defaultRateId, "standard");
  });

  it("B7: the store-wide free-above threshold zeroes the rate when the rate has none", () => {
    const result = selectRates({ rates, weightGrams: 1000, discountedSubtotalPaise: 99900, paymentMethod: "ONLINE", pincodeCodAvailable: true, settings: SETTINGS, now: NOW });
    const standard = result.rates.find((r) => r.rateId === "standard")!;
    assert.equal(standard.ratePaise, 0);
    assert.equal(standard.baseRatePaise, 7900);
    assert.equal(standard.isFree, true);
    // COD fee is never waived by free shipping.
    assert.equal(standard.codFeePaise, 4900);
  });

  it("B7: a rate's own free-above overrides the setting, even when higher", () => {
    const own = [rate({ id: "own", freeAbovePaise: 200000 })];
    const below = selectRates({ rates: own, weightGrams: 100, discountedSubtotalPaise: 150000, paymentMethod: "ONLINE", pincodeCodAvailable: true, settings: SETTINGS, now: NOW });
    assert.equal(below.rates[0].ratePaise, 7900);
    const above = selectRates({ rates: own, weightGrams: 100, discountedSubtotalPaise: 200000, paymentMethod: "ONLINE", pincodeCodAvailable: true, settings: SETTINGS, now: NOW });
    assert.equal(above.rates[0].ratePaise, 0);
  });

  it("COD: rate fee beats the setting fee; COD off on rate, store, pincode or ceiling removes it", () => {
    const withFee = selectRates({ rates: [rate({ id: "r", codFeePaise: 2500 })], weightGrams: 100, discountedSubtotalPaise: 1000, paymentMethod: "ONLINE", pincodeCodAvailable: true, settings: SETTINGS, now: NOW });
    assert.equal(withFee.rates[0].codFeePaise, 2500);

    const pinOff = selectRates({ rates, weightGrams: 100, discountedSubtotalPaise: 1000, paymentMethod: "ONLINE", pincodeCodAvailable: false, settings: SETTINGS, now: NOW });
    assert.equal(pinOff.rates[0].codAvailable, false);
    assert.equal(pinOff.rates[0].codFeePaise, 0);

    const storeOff = selectRates({ rates, weightGrams: 100, discountedSubtotalPaise: 1000, paymentMethod: "ONLINE", pincodeCodAvailable: true, settings: { ...SETTINGS, codEnabled: false }, now: NOW });
    assert.equal(storeOff.rates[0].codAvailable, false);

    const overCeiling = selectRates({ rates, weightGrams: 100, discountedSubtotalPaise: 1000001, paymentMethod: "ONLINE", pincodeCodAvailable: true, settings: SETTINGS, now: NOW });
    assert.equal(overCeiling.rates[0].codAvailable, false);
  });

  it("a COD checkout drops rates that cannot be paid by COD", () => {
    const result = selectRates({ rates, weightGrams: 1000, discountedSubtotalPaise: 50000, paymentMethod: "COD", pincodeCodAvailable: true, settings: SETTINGS, now: NOW });
    assert.deepEqual(result.rates.map((r) => r.rateId), ["standard"]);
    assert.ok(result.reasons.includes("express:cod_unavailable"));
  });

  it("default rate: cheapest STANDARD, else cheapest overall", () => {
    const standardWins = pickDefaultRate([
      { rateId: "e", method: "EXPRESS", ratePaise: 100, codFeePaise: 0 } as never,
      { rateId: "s2", method: "STANDARD", ratePaise: 900, codFeePaise: 0 } as never,
      { rateId: "s1", method: "STANDARD", ratePaise: 500, codFeePaise: 0 } as never,
    ]);
    assert.equal(standardWins, "s1");
    const cheapest = pickDefaultRate([
      { rateId: "e", method: "EXPRESS", ratePaise: 100, codFeePaise: 0 } as never,
      { rateId: "p", method: "PICKUP", ratePaise: 0, codFeePaise: 0 } as never,
    ]);
    assert.equal(cheapest, "p");
    assert.equal(pickDefaultRate([]), null);
  });

  it("estimated delivery adds the latest estimate in days", () => {
    const result = selectRates({ rates: [rate({ id: "r", estimatedDaysMin: 2, estimatedDaysMax: 5 })], weightGrams: 100, discountedSubtotalPaise: 1000, paymentMethod: "ONLINE", pincodeCodAvailable: true, settings: SETTINGS, now: NOW });
    assert.equal(result.rates[0].estimatedDeliveryAt.toISOString(), estimatedDelivery(NOW, 5).toISOString());
    assert.equal(result.rates[0].estimatedDeliveryAt.toISOString(), "2026-09-13T06:00:00.000Z");
  });

  it("no_rate_matches is recorded when every rate is excluded", () => {
    const result = selectRates({ rates: [rate({ id: "r", maxWeightGrams: 100 })], weightGrams: 5000, discountedSubtotalPaise: 1000, paymentMethod: "ONLINE", pincodeCodAvailable: true, settings: SETTINGS, now: NOW });
    assert.deepEqual(result.rates, []);
    assert.equal(result.defaultRateId, null);
    assert.ok(result.reasons.includes("no_rate_matches"));
  });
});

describe("buildTrackingUrl", () => {
  const partner = { trackingUrlTemplate: "https://www.bluedart.com/tracking?trackFor=0&trackNo={tracking}" };

  it("substitutes and URL-encodes the tracking number", () => {
    assert.equal(buildTrackingUrl(partner, "AWB 123&x=1"), "https://www.bluedart.com/tracking?trackFor=0&trackNo=AWB%20123%26x%3D1");
  });

  it("returns null for a missing template, blank number or unsafe result", () => {
    assert.equal(buildTrackingUrl(null, "X"), null);
    assert.equal(buildTrackingUrl({ trackingUrlTemplate: null }, "X"), null);
    assert.equal(buildTrackingUrl(partner, "  "), null);
    assert.equal(buildTrackingUrl({ trackingUrlTemplate: "javascript:alert({tracking})" }, "X"), null);
    assert.equal(buildTrackingUrl({ trackingUrlTemplate: "https://x.example/no-placeholder" }, "X"), null);
  });

  it("trackingTemplateProblem explains what is wrong", () => {
    assert.equal(trackingTemplateProblem(""), null);
    assert.equal(trackingTemplateProblem(partner.trackingUrlTemplate), null);
    assert.match(trackingTemplateProblem("https://x.example/track") ?? "", /must contain \{tracking\}/);
    assert.match(trackingTemplateProblem("/track/{tracking}") ?? "", /full http\(s\) URL/);
  });
});
