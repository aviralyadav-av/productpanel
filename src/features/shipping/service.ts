import type { PincodeServiceability, Prisma, PrismaClient, ShippingRate, ShippingZone } from "@prisma/client";

import { conflict, notFound } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { db } from "@/lib/db";

import { readSettingBoolean, readSettingString } from "@/features/finance/settings-reader";
import { stateCodeOf } from "@/features/shipping/india";
import {
  DEFAULT_ITEM_WEIGHT_GRAMS,
  resolveZoneFromCandidates,
  selectRates,
  sumWeightGrams,
  type QuotePaymentMethod,
  type QuoteSettings,
  type QuotedRate,
  type ZoneMatch,
} from "@/features/shipping/resolution";
import type { RateData, ZoneData } from "@/features/shipping/schemas";

/**
 * Shipping business rules (blueprint §1 Shipping, §4.6, §5.3, §14.B7, D13).
 *
 * Pure Prisma: no `server-only`, no `next/*`. The ORDERS module prices
 * checkout with `quoteShipping`, the public API answers `/shipping/pincode`
 * and `/shipping/quote` with `checkPincode` / `quoteShipping`, and the check
 * script runs all of it as plain tsx.
 *
 * Every mutation takes the actor and writes its audit row INSIDE the same
 * transaction, so a zone that silently lost its rates is not a thing that can
 * happen without a trail.
 */

export type Db = Prisma.TransactionClient | PrismaClient;
export type ShippingActor = AuditActor;
export type ClientInfo = { ip?: string | null; userAgent?: string | null };

type ZoneCandidateRow = Pick<ShippingZone, "id" | "name" | "states" | "pincodePrefixes" | "isDefault" | "isActive" | "position">;

export type ZoneRef = { id: string; name: string };

export function run<T>(tx: Db | undefined, body: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  // A caller already inside a transaction passes it through; otherwise we
  // open one so the audit row and the change commit together.
  if (tx && !("$transaction" in tx)) return body(tx);
  return ((tx as PrismaClient | undefined) ?? db).$transaction(body);
}

function label(entity: { name: string }): string {
  return entity.name;
}

// ---------------------------------------------------------------------------
// Settings the quote depends on
// ---------------------------------------------------------------------------

function paiseSetting(raw: string): number | null {
  const value = Number(raw);
  return raw.trim() !== "" && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

/** The four settings B7 and the COD rules read, in one round trip each. */
export async function loadQuoteSettings(tx?: Db): Promise<QuoteSettings & { defaultEstimateDays: number }> {
  const client = tx ?? db;
  const [freeAbove, codEnabled, codFee, codMax, estimate] = await Promise.all([
    readSettingString(client, "shipping.free_above_paise"),
    readSettingBoolean(client, "orders.cod_enabled"),
    readSettingString(client, "orders.cod_fee_paise"),
    readSettingString(client, "orders.cod_max_paise"),
    readSettingString(client, "shipping.default_estimate_days"),
  ]);
  return {
    // "Empty disables" (settings-keys help text), so "" must NOT fall back to the seeded default.
    freeAbovePaise: paiseSetting(freeAbove),
    codEnabled,
    codFeePaise: paiseSetting(codFee) ?? 0,
    codMaxPaise: paiseSetting(codMax),
    defaultEstimateDays: Math.max(0, Math.round(Number(estimate) || 5)),
  };
}

// ---------------------------------------------------------------------------
// Zone resolution, pincode check, quote
// ---------------------------------------------------------------------------

type ZoneWithRates = ZoneCandidateRow & { rates: ShippingRate[] };

async function loadActiveZones(tx?: Db): Promise<ZoneWithRates[]> {
  return (tx ?? db).shippingZone.findMany({
    where: { isActive: true },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      states: true,
      pincodePrefixes: true,
      isDefault: true,
      isActive: true,
      position: true,
      rates: { where: { isActive: true }, orderBy: [{ position: "asc" }, { ratePaise: "asc" }] },
    },
  });
}

export type ResolvedZone = { zone: ZoneWithRates | null; matchedBy: ZoneMatch | null; row: PincodeServiceability | null };

/**
 * Which zone serves a pincode: explicit row assignment → longest prefix →
 * state (from the row, else the caller's `state`) → default zone.
 */
export async function resolveZoneForPincode(
  pincode: string,
  tx?: Db,
  options: { state?: string | null } = {},
): Promise<ResolvedZone> {
  const client = tx ?? db;
  const [row, zones] = await Promise.all([
    client.pincodeServiceability.findUnique({ where: { pincode } }),
    loadActiveZones(client),
  ]);
  const stateCode = stateCodeOf(row?.state) ?? stateCodeOf(options.state);
  const resolution = resolveZoneFromCandidates({ pincode, stateCode, assignedZoneId: row?.zoneId }, zones);
  return { ...resolution, row };
}

export type PincodeCheck = {
  pincode: string;
  /** True when a PincodeServiceability row exists. */
  known: boolean;
  serviceable: boolean;
  codAvailable: boolean;
  estimatedDays: number;
  city: string | null;
  state: string | null;
  zone: ZoneRef | null;
  matchedBy: ZoneMatch | null;
  /** Store-wide free-shipping threshold (B7 fallback), for the storefront banner. */
  freeAbovePaise: number | null;
};

/**
 * Serviceability for a pincode (public `GET /shipping/pincode/:pin`).
 *
 * An unknown pincode is serviceable when a zone (typically the default) has
 * an active rate - the store ships everywhere it has not explicitly
 * excluded. A known row can switch that off, or switch COD off.
 */
export async function checkPincode(pincode: string, tx?: Db): Promise<PincodeCheck> {
  const client = tx ?? db;
  const [{ zone, matchedBy, row }, settings] = await Promise.all([resolveZoneForPincode(pincode, client), loadQuoteSettings(client)]);
  const rates = zone?.rates ?? [];
  const serviceable = (row?.isServiceable ?? true) && zone !== null && rates.length > 0;
  const codAvailable = serviceable && settings.codEnabled && (row?.codAvailable ?? true) && rates.some((rate) => rate.codAvailable);

  const standard = rates.find((rate) => rate.method === "STANDARD") ?? rates[0];
  const estimatedDays = row?.estimatedDays ?? standard?.estimatedDaysMax ?? settings.defaultEstimateDays;

  return {
    pincode,
    known: row !== null,
    serviceable,
    codAvailable,
    estimatedDays,
    city: row?.city ?? null,
    state: row?.state ?? null,
    zone: zone ? { id: zone.id, name: zone.name } : null,
    matchedBy,
    freeAbovePaise: settings.freeAbovePaise,
  };
}

export type QuoteItem = {
  variantId?: string | null;
  productId?: string | null;
  quantity: number;
  weightGrams?: number | null;
  lineTotalPaise: number;
};

/**
 * Basket weight: the variant's weight, else its product's, else 500 g per
 * unit. Items that already carry `weightGrams` skip the lookup.
 */
export async function totalWeightGrams(items: readonly QuoteItem[], tx?: Db): Promise<number> {
  const client = tx ?? db;
  const unresolved = items.filter((item) => item.weightGrams === null || item.weightGrams === undefined);
  const variantIds = [...new Set(unresolved.map((item) => item.variantId).filter((id): id is string => !!id))];
  const productIds = [...new Set(unresolved.filter((item) => !item.variantId).map((item) => item.productId).filter((id): id is string => !!id))];

  const [variants, products] = await Promise.all([
    variantIds.length
      ? client.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, weightGrams: true, product: { select: { weightGrams: true } } } })
      : [],
    productIds.length ? client.product.findMany({ where: { id: { in: productIds } }, select: { id: true, weightGrams: true } }) : [],
  ]);
  const variantWeight = new Map(variants.map((v) => [v.id, v.weightGrams ?? v.product.weightGrams ?? null]));
  const productWeight = new Map(products.map((p) => [p.id, p.weightGrams ?? null]));

  return sumWeightGrams(
    items.map((item) => ({
      quantity: item.quantity,
      weightGrams:
        item.weightGrams ??
        (item.variantId ? variantWeight.get(item.variantId) : undefined) ??
        (item.productId ? productWeight.get(item.productId) : undefined) ??
        DEFAULT_ITEM_WEIGHT_GRAMS,
    })),
  );
}

export type PricedQuoteItems = {
  items: QuoteItem[];
  subtotalPaise: number;
  /** Ids that matched nothing in the catalogue (skipped, reported). */
  missing: string[];
};

/**
 * Price catalogue references the way the storefront sees them, for callers
 * (public quote, admin preview) that only know ids and quantities. Variant
 * sale/list price, else the product's effective price (promotion-aware).
 */
export async function priceQuoteItems(
  items: ReadonlyArray<{ productId?: string | null; variantId?: string | null; quantity: number }>,
  tx?: Db,
): Promise<PricedQuoteItems> {
  const client = tx ?? db;
  const variantIds = [...new Set(items.map((item) => item.variantId).filter((id): id is string => !!id))];
  const productIds = [...new Set(items.map((item) => item.productId).filter((id): id is string => !!id))];

  const [variants, products] = await Promise.all([
    variantIds.length
      ? client.productVariant.findMany({
          where: { id: { in: variantIds } },
          select: { id: true, productId: true, pricePaise: true, salePricePaise: true, weightGrams: true, product: { select: { effectivePricePaise: true, weightGrams: true } } },
        })
      : [],
    productIds.length
      ? client.product.findMany({ where: { id: { in: productIds } }, select: { id: true, effectivePricePaise: true, weightGrams: true } })
      : [],
  ]);
  const variantById = new Map(variants.map((v) => [v.id, v]));
  const productById = new Map(products.map((p) => [p.id, p]));

  const priced: QuoteItem[] = [];
  const missing: string[] = [];
  for (const item of items) {
    const variant = item.variantId ? variantById.get(item.variantId) : undefined;
    const product = variant ? undefined : item.productId ? productById.get(item.productId) : undefined;
    if (!variant && !product) {
      missing.push(item.variantId ?? item.productId ?? "?");
      continue;
    }
    const unitPaise = variant
      ? (variant.salePricePaise ?? variant.pricePaise ?? variant.product.effectivePricePaise)
      : product!.effectivePricePaise;
    priced.push({
      variantId: variant?.id ?? null,
      productId: variant?.productId ?? product?.id ?? null,
      quantity: item.quantity,
      weightGrams: variant ? (variant.weightGrams ?? variant.product.weightGrams ?? null) : (product?.weightGrams ?? null),
      lineTotalPaise: unitPaise * item.quantity,
    });
  }
  return { items: priced, subtotalPaise: priced.reduce((sum, item) => sum + item.lineTotalPaise, 0), missing };
}

export type ShippingQuote = {
  serviceable: boolean;
  zone: ZoneRef | null;
  rates: QuotedRate[];
  defaultRateId: string | null;
  reasons: string[];
  weightGrams: number;
  pincode: PincodeCheck;
};

/**
 * Rates for a basket at a pincode (B7 free-above, weight/order bounds, COD
 * rules). `discountedSubtotalPaise` is the item subtotal AFTER promotion and
 * coupon allocations - the ORDERS module passes the same number it puts on
 * Order.subtotalPaise - discountPaise - couponDiscountPaise.
 */
export async function quoteShipping(
  input: {
    pinCode: string;
    state?: string | null;
    items: readonly QuoteItem[];
    discountedSubtotalPaise: number;
    paymentMethod: QuotePaymentMethod;
    now?: Date;
  },
  tx?: Db,
): Promise<ShippingQuote> {
  const client = tx ?? db;
  const now = input.now ?? new Date();
  const [check, resolved, settings, weightGrams] = await Promise.all([
    checkPincode(input.pinCode, client),
    resolveZoneForPincode(input.pinCode, client, { state: input.state }),
    loadQuoteSettings(client),
    totalWeightGrams(input.items, client),
  ]);

  const zone = resolved.zone;
  const reasons: string[] = [];
  if (!zone) reasons.push("no_zone");
  else if (resolved.row && !resolved.row.isServiceable) reasons.push("pincode_not_serviceable");

  if (!zone || (resolved.row && !resolved.row.isServiceable)) {
    return { serviceable: false, zone: zone ? { id: zone.id, name: zone.name } : null, rates: [], defaultRateId: null, reasons, weightGrams, pincode: check };
  }

  const selection = selectRates({
    rates: zone.rates,
    weightGrams,
    discountedSubtotalPaise: Math.max(0, input.discountedSubtotalPaise),
    paymentMethod: input.paymentMethod,
    pincodeCodAvailable: resolved.row?.codAvailable ?? true,
    settings,
    now,
  });

  return {
    serviceable: selection.rates.length > 0,
    zone: { id: zone.id, name: zone.name },
    rates: selection.rates,
    defaultRateId: selection.defaultRateId,
    reasons: [...reasons, ...selection.reasons],
    weightGrams,
    pincode: check,
  };
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

const zoneAudit = (zone: ShippingZone): Record<string, unknown> => ({
  name: zone.name,
  description: zone.description,
  countries: zone.countries,
  states: zone.states,
  pincodePrefixes: zone.pincodePrefixes,
  isDefault: zone.isDefault,
  isActive: zone.isActive,
  position: zone.position,
});

export async function createZone(data: ZoneData, actor: ShippingActor, client: ClientInfo = {}, tx?: Db): Promise<ShippingZone> {
  return run(tx, async (t) => {
    const count = await t.shippingZone.count();
    // The first zone is the default whatever the form said: without one, an
    // unknown pincode resolves to nothing and the store ships nowhere.
    const isDefault = count === 0 ? true : data.isDefault;
    if (isDefault) await t.shippingZone.updateMany({ where: { isDefault: true }, data: { isDefault: false } });

    const zone = await t.shippingZone.create({ data: { ...data, isDefault, isActive: isDefault ? true : data.isActive } });
    await writeAudit(t, {
      actor,
      action: "shipping_zone.create",
      entityType: "ShippingZone",
      entityId: zone.id,
      entityLabel: label(zone),
      summary: `Created shipping zone "${zone.name}"${isDefault ? " (default)" : ""}.`,
      diff: diffOf(null, zoneAudit(zone)),
      ...client,
    });
    return zone;
  });
}

export async function updateZone(id: string, data: ZoneData, actor: ShippingActor, client: ClientInfo = {}, tx?: Db): Promise<ShippingZone> {
  return run(tx, async (t) => {
    const before = await t.shippingZone.findUnique({ where: { id } });
    if (!before) throw notFound("Shipping zone");

    if (before.isDefault && !data.isDefault) {
      throw conflict("This is the default zone. Make another zone the default first.", { isDefault: "Pick another default zone first." });
    }
    if (data.isDefault && !data.isActive) {
      throw conflict("The default zone must stay active - it is where unknown pincodes fall back to.", { isActive: "The default zone cannot be switched off." });
    }
    if (data.isDefault && !before.isDefault) {
      await t.shippingZone.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
    }

    const zone = await t.shippingZone.update({ where: { id }, data });
    await writeAudit(t, {
      actor,
      action: "shipping_zone.update",
      entityType: "ShippingZone",
      entityId: zone.id,
      entityLabel: label(zone),
      summary: `Updated shipping zone "${zone.name}".`,
      diff: diffOf(zoneAudit(before), zoneAudit(zone)),
      ...client,
    });
    return zone;
  });
}

export async function deleteZone(id: string, actor: ShippingActor, client: ClientInfo = {}, tx?: Db): Promise<{ id: string; name: string }> {
  return run(tx, async (t) => {
    const zone = await t.shippingZone.findUnique({ where: { id }, include: { _count: { select: { rates: true, pincodes: true } } } });
    if (!zone) throw notFound("Shipping zone");
    if (zone.isDefault) throw conflict("The default zone cannot be deleted. Make another zone the default first.");
    if (zone._count.rates > 0) {
      throw conflict(`"${zone.name}" still has ${zone._count.rates} rate${zone._count.rates === 1 ? "" : "s"}. Delete or move them first.`);
    }

    // Pincodes referencing the zone fall back to prefix/state/default resolution (FK SetNull).
    await t.shippingZone.delete({ where: { id } });
    await writeAudit(t, {
      actor,
      action: "shipping_zone.delete",
      entityType: "ShippingZone",
      entityId: id,
      entityLabel: zone.name,
      summary: `Deleted shipping zone "${zone.name}" (${zone._count.pincodes} pincodes unassigned).`,
      diff: diffOf(zoneAudit(zone), null),
      ...client,
    });
    return { id, name: zone.name };
  });
}

/** Positions follow the order of `ids`; zones not listed keep theirs. */
export async function reorderZones(ids: readonly string[], actor: ShippingActor, client: ClientInfo = {}, tx?: Db): Promise<{ moved: number }> {
  return run(tx, async (t) => {
    await Promise.all(ids.map((id, index) => t.shippingZone.updateMany({ where: { id }, data: { position: index } })));
    await writeAudit(t, {
      actor,
      action: "shipping_zone.reorder",
      entityType: "ShippingZone",
      summary: `Reordered ${ids.length} shipping zones.`,
      diff: { ids: [...ids] },
      ...client,
    });
    return { moved: ids.length };
  });
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

const rateAudit = (rate: ShippingRate): Record<string, unknown> => {
  const { id: _id, ...rest } = rate;
  void _id;
  return rest;
};

export async function createRate(data: RateData, actor: ShippingActor, client: ClientInfo = {}, tx?: Db): Promise<ShippingRate> {
  return run(tx, async (t) => {
    const zone = await t.shippingZone.findUnique({ where: { id: data.zoneId }, select: { id: true, name: true } });
    if (!zone) throw notFound("Shipping zone");
    const rate = await t.shippingRate.create({ data });
    await writeAudit(t, {
      actor,
      action: "shipping_rate.create",
      entityType: "ShippingRate",
      entityId: rate.id,
      entityLabel: rate.name,
      summary: `Created rate "${rate.name}" in zone "${zone.name}".`,
      diff: diffOf(null, rateAudit(rate)),
      ...client,
    });
    return rate;
  });
}

export async function updateRate(id: string, data: RateData, actor: ShippingActor, client: ClientInfo = {}, tx?: Db): Promise<ShippingRate> {
  return run(tx, async (t) => {
    const before = await t.shippingRate.findUnique({ where: { id } });
    if (!before) throw notFound("Shipping rate");
    if (data.zoneId !== before.zoneId) {
      const zone = await t.shippingZone.findUnique({ where: { id: data.zoneId }, select: { id: true } });
      if (!zone) throw notFound("Shipping zone");
    }
    const rate = await t.shippingRate.update({ where: { id }, data });
    await writeAudit(t, {
      actor,
      action: "shipping_rate.update",
      entityType: "ShippingRate",
      entityId: rate.id,
      entityLabel: rate.name,
      summary: `Updated rate "${rate.name}".`,
      diff: diffOf(rateAudit(before), rateAudit(rate)),
      ...client,
    });
    return rate;
  });
}

export async function setRateActive(id: string, isActive: boolean, actor: ShippingActor, client: ClientInfo = {}, tx?: Db): Promise<ShippingRate> {
  return run(tx, async (t) => {
    const before = await t.shippingRate.findUnique({ where: { id } });
    if (!before) throw notFound("Shipping rate");
    const rate = await t.shippingRate.update({ where: { id }, data: { isActive } });
    await writeAudit(t, {
      actor,
      action: "shipping_rate.update",
      entityType: "ShippingRate",
      entityId: id,
      entityLabel: rate.name,
      summary: `${isActive ? "Enabled" : "Disabled"} rate "${rate.name}".`,
      diff: diffOf({ isActive: before.isActive }, { isActive }),
      ...client,
    });
    return rate;
  });
}

/** Orders keep their snapshot (`Order.shippingRateId` is SetNull), so deletion is allowed. */
export async function deleteRate(id: string, actor: ShippingActor, client: ClientInfo = {}, tx?: Db): Promise<{ id: string; name: string }> {
  return run(tx, async (t) => {
    const rate = await t.shippingRate.findUnique({ where: { id } });
    if (!rate) throw notFound("Shipping rate");
    await t.shippingRate.delete({ where: { id } });
    await writeAudit(t, {
      actor,
      action: "shipping_rate.delete",
      entityType: "ShippingRate",
      entityId: id,
      entityLabel: rate.name,
      summary: `Deleted rate "${rate.name}".`,
      diff: diffOf(rateAudit(rate), null),
      ...client,
    });
    return { id, name: rate.name };
  });
}

// ---------------------------------------------------------------------------
// Partners and pincode rows live in admin-service.ts (file size); one import path.
// ---------------------------------------------------------------------------

export {
  bulkUpdatePincodes,
  createPartner,
  deletePartner,
  deletePincode,
  setPartnerActive,
  updatePartner,
  updatePincode,
  upsertPincode,
  type BulkPincodeResult,
} from "@/features/shipping/admin-service";
