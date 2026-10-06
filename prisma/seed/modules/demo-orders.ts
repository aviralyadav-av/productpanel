import type { Prisma, PrismaClient } from "@prisma/client";

import {
  applyCoupon,
  applyPromotion,
  computeCommission,
  computeLineFinancials,
  computeOrderTotals,
  derivePaymentStatus,
  lineInScope,
  promotionUnitPrice,
  resolveShippingPaise,
} from "@/features/finance/math";
import { loadChargeRules, nextNumber, recordEarningsForDeliveredItems, resolveCommission } from "@/features/finance/service";
import { readSettingBoolean, readSettingNumber, readSettingString } from "@/features/finance/settings-reader";
import { hashToken, randomToken } from "@/lib/crypto";
import { isOnSale } from "@/lib/money";
import type { SeedContext } from "./context";
import { formatInr } from "../lib/money";
import { addHours, addMinutes, createRng, daysAgo, maxDate, minDate, type Rng } from "../lib/rng";
import {
  ancestorIdsForPath,
  demoId,
  INDIAN_CITIES,
  mediaId,
  mediaUrlOf,
  state,
  STREETS,
  transaction,
  type DemoCustomer,
  type DemoProduct,
  type DemoVariant,
  type Tx,
} from "../lib/state";

/**
 * ~150 demo orders over the last 90 days (blueprint §12, §14.B/C).
 *
 * Every order is planned deterministically (customer, lines, coupon, payment
 * method, outcome, timeline) and then written in ONE transaction through the
 * real services: money via finance/math (B1-B3, B7), commission snapshotted
 * with resolveCommission (B3), shipments per seller (C1), COD cash payments
 * on delivery and earnings on delivered shipments (B4, B6).
 *
 * Stock is NOT moved here. Movements span the whole ninety days (a reserve
 * on day 2, a cancellation restock on day 5) and the ledger must be written
 * in time order for `balance` to read correctly, so demo-stock.ts derives the
 * C3 movements from the persisted orders and returns and applies them sorted
 * by time. Planning here is conservative: a reservation consumes availability
 * and neither a release nor a restock gives it back, so the time-ordered
 * replay can never run short.
 *
 * Idempotent: an order id that already exists is skipped; the transaction
 * either committed the whole order or none of it.
 */

const ORDER_COUNT = 150;

type Stage = "PENDING" | "CONFIRMED" | "PROCESSING" | "PACKED" | "SHIPPED" | "OUT_FOR_DELIVERY" | "DELIVERED";
type Outcome = "FLOW" | "CANCELLED" | "FAILED";
type PaymentMethod = "COD" | "ONLINE";

type CustomizationSnapshot = { optionId: string; type: string; label: string; value: string; fileUrls: string[]; priceDeltaPaise: number };

type LinePlan = {
  index: number;
  product: DemoProduct;
  variant: DemoVariant;
  quantity: number;
  listPricePaise: number;
  unitPricePaise: number;
  customization: CustomizationSnapshot[] | null;
  customizationPaise: number;
  promotionDiscountPaise: number;
  promotionFundedBy: string | null;
  couponDiscountPaise: number;
};

type GroupPlan = {
  key: string;
  sellerId: string | null;
  lines: LinePlan[];
  shippedAt: Date;
  transitAt: Date;
  ofdAt: Date;
  deliveredAt: Date;
  stage: Stage;
};

type Settings = {
  codFeePaise: number;
  freeAbovePaise: number;
  pricesIncludeTax: boolean;
  taxRemittedBy: "SELLER" | "PLATFORM";
  defaultTaxBps: number;
  paymentTimeoutMinutes: number;
};

type Rate = { id: string; name: string; method: string; ratePaise: number; freeAbovePaise: number | null; codAvailable: boolean };
type Partner = { id: string; code: string; name: string; trackingUrlTemplate: string | null };

const NAMES = ["Aarav", "Diya", "Kabir", "Myra", "Vihaan", "Anaya", "Reyansh", "Saanvi", "Ishaan", "Zara"];
const MESSAGES = ["Happy birthday, Maa!", "To new beginnings", "Forever & always", "Congratulations on the new home", "Best team ever - 2026", "You are my sunshine"];
const ENGRAVINGS = ["The Sharmas", "A & K · 14.02.2020", "Est. 2019", "Papa's favourite", "With love, R", "Class of 2026"];
const INSTRUCTIONS = ["Please gift wrap.", "Deliver after 6 pm.", "Use the second photo for the face.", "Keep the background plain.", "Add a small card saying Happy Anniversary."];
const CUSTOMER_NOTES = ["Please gift wrap - it's a birthday present.", "Call before delivery, the gate is usually locked.", "Leave with the security desk if nobody answers.", "Fragile - please pack with extra care."];
const INTERNAL_NOTES = ["Called customer to confirm the pincode.", "Seller asked for an extra day - customer informed.", "Address corrected: flat number was missing.", "Customer requested invoice with GSTIN; added to packing slip."];
const CANCEL_REASONS = ["Customer requested cancellation", "Duplicate order placed by mistake", "Address not serviceable by any partner", "Customer found the item elsewhere", "Payment not confirmed within the window"];
const USER_AGENTS = [
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15",
];
const HUBS = ["Delhi NCR sorting hub", "Mumbai Bhiwandi hub", "Bengaluru Nelamangala hub", "Kolkata Dankuni hub", "Nagpur transit hub"];

// ---------------------------------------------------------------------------
// Planning helpers
// ---------------------------------------------------------------------------

function unitPricing(product: DemoProduct, variant: DemoVariant, at: Date): { list: number; unit: number } {
  const list = variant.pricePaise ?? product.pricePaise;
  const saleCandidate = variant.salePricePaise ?? (variant.pricePaise === null ? product.salePricePaise : null);
  const onSale =
    saleCandidate !== null &&
    saleCandidate < list &&
    isOnSale({ pricePaise: list, salePricePaise: saleCandidate, saleStartsAt: product.saleStartsAt, saleEndsAt: product.saleEndsAt, now: at });
  return { list, unit: onSale ? (saleCandidate as number) : list };
}

function customizationFor(product: DemoProduct, rng: Rng): { snapshot: CustomizationSnapshot[]; perUnitPaise: number } {
  const snapshot: CustomizationSnapshot[] = [];
  let perUnitPaise = 0;
  for (const option of product.options) {
    if (!option.isRequired && !rng.chance(0.6)) continue;
    let value = "";
    let fileUrls: string[] = [];
    let priceDeltaPaise = option.priceDeltaPaise;
    switch (option.type) {
      case "NAME":
        value = rng.pick(NAMES);
        break;
      case "MESSAGE":
        value = rng.pick(MESSAGES);
        break;
      case "ENGRAVING":
      case "TEXT":
        value = rng.pick(ENGRAVINGS);
        break;
      case "INSTRUCTIONS":
        value = rng.pick(INSTRUCTIONS);
        break;
      case "PHOTO":
      case "IMAGE": {
        const count = rng.int(1, Math.min(3, Math.max(1, option.maxFiles ?? 1)));
        fileUrls = Array.from({ length: count }, (_item, index) => mediaUrlOf(mediaId(`upload:${(index % 3) + 1}`)) ?? "");
        value = `${count} photo${count > 1 ? "s" : ""} uploaded`;
        break;
      }
      case "DESIGN_SELECT":
      case "COLOR_SELECT":
      case "SIZE_SELECT":
      case "DROPDOWN": {
        const choice = option.choices.length > 0 ? rng.pick(option.choices) : null;
        value = choice?.label ?? "";
        priceDeltaPaise += choice?.priceDeltaPaise ?? 0;
        break;
      }
      case "CHECKBOX":
        value = "Yes";
        break;
      default:
        value = rng.pick(MESSAGES);
    }
    perUnitPaise += priceDeltaPaise;
    snapshot.push({ optionId: option.id, type: option.type, label: option.label, value, fileUrls, priceDeltaPaise });
  }
  return { snapshot, perUnitPaise };
}

function stageAt(order: Pick<Timeline, "confirmedAt" | "processingAt" | "packedAt">, groups: GroupPlan[], now: Date): Stage {
  if (order.confirmedAt > now) return "PENDING";
  if (order.processingAt > now) return "CONFIRMED";
  if (order.packedAt > now) return "PROCESSING";
  if (groups.every((group) => group.stage === "PACKED")) return "PACKED";
  if (groups.every((group) => group.stage === "DELIVERED")) return "DELIVERED";
  if (groups.some((group) => group.stage === "OUT_FOR_DELIVERY")) return "OUT_FOR_DELIVERY";
  return "SHIPPED";
}

type Timeline = {
  payAt: Date;
  confirmedAt: Date;
  processingAt: Date;
  packedAt: Date;
  shippedAt: Date;
};

function timelineFor(placedAt: Date, method: PaymentMethod, rng: Rng): Timeline {
  const payAt = addMinutes(placedAt, rng.float(1, 4));
  const confirmedAt = method === "ONLINE" ? addMinutes(payAt, 0.2) : addHours(placedAt, rng.float(2, 30));
  const processingAt = addHours(confirmedAt, rng.float(3, 30));
  const packedAt = addHours(processingAt, rng.float(10, 40));
  const shippedAt = addHours(packedAt, rng.float(3, 24));
  return { payAt, confirmedAt, processingAt, packedAt, shippedAt };
}

function groupTimeline(shippedAt: Date, offsetHours: number, rng: Rng, now: Date): Omit<GroupPlan, "key" | "sellerId" | "lines"> {
  const shipped = addHours(shippedAt, offsetHours);
  const transitAt = addHours(shipped, rng.float(12, 36));
  const ofdAt = addHours(transitAt, rng.float(24, 84));
  const deliveredAt = addHours(ofdAt, rng.float(2, 9));
  const stage: Stage = shipped > now ? "PACKED" : ofdAt > now ? "SHIPPED" : deliveredAt > now ? "OUT_FOR_DELIVERY" : "DELIVERED";
  return { shippedAt: shipped, transitAt, ofdAt, deliveredAt, stage };
}

function guestAddress(rng: Rng, n: number) {
  const city = INDIAN_CITIES[(n * 11) % INDIAN_CITIES.length];
  return {
    fullName: `${rng.pick(NAMES)} ${rng.pick(["Bhatia", "Dutta", "Fernandes", "Gill", "Khanna"])}`,
    phone: `+91${9100000000 + n * 7919}`,
    line1: `${rng.int(1, 200)}, ${rng.pick(STREETS)}`,
    line2: null as string | null,
    landmark: null as string | null,
    city: city.city,
    state: city.state,
    pinCode: city.pin,
  };
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

export async function seedDemoOrders(db: PrismaClient, ctx: SeedContext): Promise<void> {
  const rng = createRng("orders");
  const now = state.now;

  const settings: Settings = {
    codFeePaise: await readSettingNumber(db, "orders.cod_fee_paise"),
    freeAbovePaise: await readSettingNumber(db, "shipping.free_above_paise"),
    pricesIncludeTax: await readSettingBoolean(db, "tax.prices_include_tax"),
    taxRemittedBy: (await readSettingString(db, "tax.goods_remitted_by")) === "PLATFORM" ? "PLATFORM" : "SELLER",
    defaultTaxBps: await readSettingNumber(db, "tax.default_bps"),
    paymentTimeoutMinutes: await readSettingNumber(db, "checkout.payment_timeout_minutes") || 20,
  };
  const chargeRules = await loadChargeRules(db);
  const rates: Rate[] = await db.shippingRate.findMany({
    where: { isActive: true },
    select: { id: true, name: true, method: true, ratePaise: true, freeAbovePaise: true, codAvailable: true },
    orderBy: { position: "asc" },
  });
  const standardRate = rates.find((rate) => rate.method === "STANDARD") ?? rates[0];
  const expressRate = rates.find((rate) => rate.method === "EXPRESS") ?? standardRate;
  const partners: Partner[] = await db.shippingPartner.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true, trackingUrlTemplate: true },
    orderBy: { position: "asc" },
  });
  if (!standardRate || partners.length === 0) throw new Error("Demo orders need at least one shipping rate and one shipping partner");

  const activeSellerIds = new Set(state.sellers.filter((seller) => seller.status === "ACTIVE").map((seller) => seller.id));
  const sellerName = new Map(state.sellers.map((seller) => [seller.id, seller.displayName]));
  const sellerCity = new Map(state.sellers.map((seller) => [seller.id, seller.city ?? "Jaipur"]));
  const sellable = state.products.filter(
    (product) => product.status === "PUBLISHED" && (product.sellerId === null || activeSellerIds.has(product.sellerId)),
  );
  const activeCustomers = state.customers.filter((customer) => customer.status === "ACTIVE");
  const blockedCustomers = state.customers.filter((customer) => customer.status === "BLOCKED");
  const couponUsage = new Map(state.coupons.map((coupon) => [coupon.id, coupon.usageCount]));
  const ordersByCustomer = new Map<string, number>();

  // ---- placement times: 40% in the last ten days; the newest eight are hours or
  // minutes old so the queue has PENDING/CONFIRMED work, and the last three are
  // shoppers still on the payment page (reservation held, not yet paid).
  const ABANDONED_TAIL = 3;
  const placements = Array.from({ length: ORDER_COUNT }, (_item, index) => {
    if (index >= ORDER_COUNT - ABANDONED_TAIL) return addMinutes(now, -rng.float(2, 15));
    if (index >= ORDER_COUNT - 8) return addMinutes(now, -rng.float(20, 300));
    const recent = rng.chance(0.4);
    return daysAgo(now, recent ? rng.float(0.3, 10) : rng.float(10, 90));
  }).sort((a, b) => a.getTime() - b.getTime());

  let created = 0;
  let skipped = 0;
  const statusCounts = new Map<string, number>();

  for (let index = 0; index < ORDER_COUNT; index += 1) {
    const n = index + 1;
    const id = demoId("order", n);
    state.orderIds.push(id);
    const existing = await db.order.findUnique({ where: { id }, select: { id: true, status: true } });
    if (existing) {
      skipped += 1;
      statusCounts.set(existing.status, (statusCounts.get(existing.status) ?? 0) + 1);
      continue;
    }

    const placedAt = placements[index];
    const ageDays = (now.getTime() - placedAt.getTime()) / 86_400_000;

    // ---- who ----------------------------------------------------------------------------
    const isGuest = rng.chance(0.05);
    const customer: DemoCustomer | null = isGuest
      ? null
      : ageDays > 20 && rng.chance(0.08)
        ? rng.pick(blockedCustomers)
        : rng.weighted(activeCustomers.map((item) => [item, item.id <= "demo_cust_012" ? 3 : 1] as const));
    const forcedAbandoned = index >= ORDER_COUNT - ABANDONED_TAIL;
    const isManual = !isGuest && !forcedAbandoned && rng.chance(0.03);
    const paymentMethod: PaymentMethod = forcedAbandoned ? "ONLINE" : isManual ? "COD" : rng.chance(0.55) ? "ONLINE" : "COD";

    // ---- lines ----------------------------------------------------------------------------
    const lineCount = rng.weighted([[1, 50], [2, 30], [3, 14], [4, 6]] as const);
    const lines: LinePlan[] = [];
    const groupKeys = new Set<string>();
    for (let attempt = 0; attempt < 40 && lines.length < lineCount; attempt += 1) {
      const product = rng.weighted(sellable.map((item) => [item, item.isBestseller ? 3 : 1] as const));
      if (product.createdAt > placedAt) continue; // not listed yet on that day
      if (lines.some((line) => line.product.id === product.id)) continue;
      const key = product.sellerId ?? "__platform";
      if (!groupKeys.has(key) && groupKeys.size >= 2) continue;
      const variants = product.variants.filter((variant) => variant.isActive && variant.available >= 1);
      if (variants.length === 0) continue;
      const variant = rng.pick(variants);
      const quantity = Math.min(rng.weighted([[1, 75], [2, 18], [3, 7]] as const), variant.available);
      const { list, unit } = unitPricing(product, variant, placedAt);
      const custom = product.isCustomizable && product.options.length > 0 ? customizationFor(product, rng) : null;
      lines.push({
        index: lines.length,
        product,
        variant,
        quantity,
        listPricePaise: list,
        unitPricePaise: unit,
        customization: custom ? custom.snapshot : null,
        customizationPaise: custom?.perUnitPaise ?? 0,
        promotionDiscountPaise: 0,
        promotionFundedBy: null,
        couponDiscountPaise: 0,
      });
      groupKeys.add(key);
    }
    if (lines.length === 0) throw new Error("Demo orders: no sellable stock left to build an order");

    // ---- promotions first (B2) ----------------------------------------------------------
    for (const line of lines) {
      const ancestors = ancestorIdsForPath(line.product.categoryPath);
      const applicable = state.promotions
        .filter((promotion) => promotion.isActive && promotion.startsAt <= placedAt && promotion.endsAt >= placedAt)
        .filter((promotion) => lineInScope(promotion, { productId: line.product.id, sellerId: line.product.sellerId, categoryAncestorIds: ancestors }))
        .sort((x, y) => promotionUnitPrice(line.unitPricePaise, x) - promotionUnitPrice(line.unitPricePaise, y) || y.priority - x.priority);
      const best = applicable[0];
      if (!best) continue;
      const { discountPaise } = applyPromotion({ promotion: best, lines: [{ unitPricePaise: line.unitPricePaise, quantity: line.quantity }] });
      if (discountPaise > 0) {
        line.promotionDiscountPaise = discountPaise;
        line.promotionFundedBy = best.fundedBy;
      }
    }

    // ---- coupon second (B2) --------------------------------------------------------------
    const lineGrossOf = (line: LinePlan) => (line.unitPricePaise + line.customizationPaise) * line.quantity;
    const discountedSubtotal = lines.reduce((sum, line) => sum + lineGrossOf(line) - line.promotionDiscountPaise, 0);
    let coupon: (typeof state.coupons)[number] | null = null;
    let freeShippingCoupon = false;
    if (rng.chance(0.22)) {
      const priorOrders = customer ? ordersByCustomer.get(customer.id) ?? 0 : 0;
      const candidates = rng
        .shuffle(state.coupons)
        .sort((x, y) => Number(y.code === "EARLYBIRD") - Number(x.code === "EARLYBIRD"))
        .filter((item) => item.isActive)
        .filter((item) => !item.startsAt || item.startsAt <= placedAt)
        .filter((item) => !item.endsAt || item.endsAt >= placedAt)
        .filter((item) => item.usageLimit === null || (couponUsage.get(item.id) ?? 0) < item.usageLimit)
        .filter((item) => item.customerIds.length === 0 || (customer && item.customerIds.includes(customer.id)))
        .filter((item) => !item.firstOrderOnly || priorOrders === 0);
      for (const candidate of candidates) {
        const eligible = lines.filter((line) =>
          lineInScope(candidate, { productId: line.product.id, sellerId: line.product.sellerId, categoryAncestorIds: ancestorIdsForPath(line.product.categoryPath) }),
        );
        const application = applyCoupon({
          coupon: candidate,
          eligibleLines: eligible.map((line) => ({ weightPaise: lineGrossOf(line) - line.promotionDiscountPaise })),
          subtotalPaise: discountedSubtotal,
        });
        if (application.rejection) continue;
        if (application.freeShipping) {
          freeShippingCoupon = true;
        } else if (application.discountPaise <= 0) {
          continue;
        } else {
          eligible.forEach((line, i) => {
            line.couponDiscountPaise = application.perLine[i];
          });
        }
        coupon = candidate;
        break;
      }
    }

    // ---- shipping, fees, totals (B1, B7) ------------------------------------------------
    const rate = paymentMethod === "ONLINE" && rng.chance(0.15) ? expressRate : standardRate;
    const shippingPaise = resolveShippingPaise({
      ratePaise: rate.ratePaise,
      rateFreeAbovePaise: rate.freeAbovePaise,
      settingFreeAbovePaise: settings.freeAbovePaise,
      discountedSubtotalPaise: lines.reduce((sum, line) => sum + lineGrossOf(line) - line.promotionDiscountPaise - line.couponDiscountPaise, 0),
    });
    const codFeePaise = paymentMethod === "COD" ? settings.codFeePaise : 0;

    // ---- outcome + timeline -----------------------------------------------------------------
    const timeline = timelineFor(placedAt, paymentMethod, rng);
    if (isManual) {
      timeline.confirmedAt = addMinutes(placedAt, 1);
      timeline.processingAt = addHours(placedAt, rng.float(2, 20));
    }
    const groupsMap = new Map<string, LinePlan[]>();
    for (const line of lines) {
      const key = line.product.sellerId ?? "__platform";
      groupsMap.set(key, [...(groupsMap.get(key) ?? []), line]);
    }
    const groups: GroupPlan[] = [...groupsMap.entries()].map(([key, groupLines], g) => ({
      key,
      sellerId: key === "__platform" ? null : key,
      lines: groupLines,
      ...groupTimeline(timeline.shippedAt, g === 1 && rng.chance(0.35) ? rng.float(24, 72) : 0, rng, now),
    }));

    let outcome: Outcome = "FLOW";
    let cancelledAt: Date | null = null;
    let cancelBeforeConfirm = false;
    // Shoppers who opened the payment page in the last couple of hours and
    // have not paid yet: the order sits PENDING with its reservation held.
    const abandonedPayment = forcedAbandoned || (paymentMethod === "ONLINE" && ageDays * 24 < 2 && rng.chance(0.5));
    const roll = rng.next();
    if (roll < 0.1 && !abandonedPayment) {
      cancelBeforeConfirm = rng.chance(0.5);
      cancelledAt = cancelBeforeConfirm ? addMinutes(placedAt, rng.float(10, 180)) : addHours(timeline.processingAt, rng.float(1, 8));
      outcome = cancelledAt <= now ? "CANCELLED" : "FLOW";
    } else if (roll < 0.14 && paymentMethod === "ONLINE" && !abandonedPayment) {
      outcome = addMinutes(placedAt, settings.paymentTimeoutMinutes) <= now ? "FAILED" : "FLOW";
    }
    const stage: Stage = outcome !== "FLOW" || abandonedPayment ? "PENDING" : stageAt(timeline, groups, now);
    const status =
      outcome === "CANCELLED" ? "CANCELLED" : outcome === "FAILED" ? "FAILED" : stage;
    const confirmed = outcome === "FLOW" ? stage !== "PENDING" : outcome === "CANCELLED" && !cancelBeforeConfirm;

    // ---- write ---------------------------------------------------------------------------------
    await transaction(db, async (tx: Tx) => {
      const { seq, number: orderNumber } = await nextNumber(tx, "Order");
      const actor = ctx.adminUserId;
      const events: Prisma.OrderEventCreateManyInput[] = [];
      const event = (type: string, message: string, createdAt: Date, extra: Partial<Prisma.OrderEventCreateManyInput> = {}) =>
        events.push({ orderId: id, type, message, createdAt, ...extra });

      // line money + commission snapshots (B1, B3)
      const seenSeller = new Set<string>();
      const items: Prisma.OrderItemCreateManyInput[] = [];
      const totalsLines: Array<{ lineGross: number; promotionDiscountPaise: number; couponDiscountPaise: number; taxPaise: number; lineTotalPaise: number }> = [];
      for (const line of lines) {
        const sellerFunded =
          (line.promotionFundedBy === "SELLER" ? line.promotionDiscountPaise : 0) + (coupon?.fundedBy === "SELLER" ? line.couponDiscountPaise : 0);
        const platformFunded =
          (line.promotionFundedBy === "PLATFORM" ? line.promotionDiscountPaise : 0) + (coupon?.fundedBy !== "SELLER" ? line.couponDiscountPaise : 0);
        const taxRateBps = line.product.taxRateBps ?? settings.defaultTaxBps;
        const money = computeLineFinancials({
          unitPricePaise: line.unitPricePaise,
          customizationPaise: line.customizationPaise,
          quantity: line.quantity,
          sellerFundedDiscountPaise: sellerFunded,
          platformFundedDiscountPaise: platformFunded,
          taxRateBps,
          pricesIncludeTax: settings.pricesIncludeTax,
        });
        let commission = { rateBps: 0, fixedPaise: 0, ruleId: null as string | null, commissionPaise: 0, chargesPaise: 0, sellerPayablePaise: 0 };
        if (line.product.sellerId) {
          const resolved = await resolveCommission(tx, {
            productId: line.product.id,
            sellerId: line.product.sellerId,
            categoryId: line.product.categoryId,
            categoryPath: line.product.categoryPath,
            now: placedAt,
          });
          const computed = computeCommission({
            lineGross: money.lineGross,
            sellerFundedDiscountPaise: sellerFunded,
            taxRateBps,
            pricesIncludeTax: settings.pricesIncludeTax,
            taxRemittedBy: settings.taxRemittedBy,
            rateBps: resolved.rateBps,
            fixedPaise: resolved.fixedPaise,
            quantity: line.quantity,
            charges: chargeRules,
            paymentMethod,
            applyPerOrderCharges: !seenSeller.has(line.product.sellerId),
          });
          seenSeller.add(line.product.sellerId);
          commission = {
            rateBps: resolved.rateBps,
            fixedPaise: resolved.fixedPaise,
            ruleId: resolved.ruleId,
            commissionPaise: computed.commissionPaise,
            chargesPaise: computed.chargesPaise,
            sellerPayablePaise: computed.sellerPayablePaise,
          };
        }
        totalsLines.push({
          lineGross: money.lineGross,
          promotionDiscountPaise: line.promotionDiscountPaise,
          couponDiscountPaise: line.couponDiscountPaise,
          taxPaise: money.taxPaise,
          lineTotalPaise: money.lineTotalPaise,
        });
        items.push({
          id: demoId("oi", n, line.index + 1),
          orderId: id,
          productId: line.product.id,
          variantId: line.variant.id,
          sellerId: line.product.sellerId,
          categoryId: line.product.categoryId,
          titleSnapshot: line.product.title,
          variantSnapshot: line.variant.name === "Default" ? null : line.variant.name,
          skuSnapshot: line.variant.sku,
          sellerNameSnapshot: line.product.sellerId ? sellerName.get(line.product.sellerId) ?? null : "DIY Baazar",
          categoryPathSnapshot: line.product.categoryPath,
          hsnCodeSnapshot: line.product.hsnCode,
          brandSnapshot: line.product.brand,
          costPaiseSnapshot: line.product.costPaise,
          imageUrl: line.product.imageUrl,
          attributesSnapshot: line.variant.attributes,
          customization: line.customization ?? undefined,
          listPricePaise: line.listPricePaise,
          unitPricePaise: line.unitPricePaise,
          customizationPaise: line.customizationPaise,
          quantity: line.quantity,
          discountPaise: money.discountPaise,
          sellerFundedDiscountPaise: sellerFunded,
          platformFundedDiscountPaise: platformFunded,
          taxRateBps,
          taxPaise: money.taxPaise,
          lineTotalPaise: money.lineTotalPaise,
          commissionBps: commission.rateBps,
          commissionFixedPaise: commission.fixedPaise,
          commissionRuleId: commission.ruleId,
          commissionPaise: commission.commissionPaise,
          chargesPaise: commission.chargesPaise,
          sellerPayablePaise: commission.sellerPayablePaise,
          status: outcome === "CANCELLED" ? "CANCELLED" : "ACTIVE",
          reservedQty: status === "PENDING" ? line.quantity : 0,
        });
      }
      const totals = computeOrderTotals(totalsLines, { shippingPaise, codFeePaise, freeShippingCoupon });

      // ---- order row -------------------------------------------------------------------------
      const shipping = customer?.addresses.find((address) => address.isDefault) ?? customer?.addresses[0] ?? guestAddress(rng, n);
      const billing = customer?.addresses.find((address) => address.type === "BILLING") ?? (rng.chance(0.25) ? shipping : null);
      const customerNote = rng.chance(0.25) ? rng.pick(CUSTOMER_NOTES) : null;
      const guestEmail = customer ? null : `guest${n}@example.com`;

      await tx.order.create({
        data: {
          id,
          seq,
          orderNumber,
          customerId: customer?.id ?? null,
          guestEmail,
          status: "PENDING",
          paymentStatus: "PENDING",
          paymentMethod,
          source: isManual ? "MANUAL" : "STOREFRONT",
          currency: "INR",
          subtotalPaise: totals.subtotalPaise,
          discountPaise: totals.discountPaise,
          couponDiscountPaise: totals.couponDiscountPaise,
          shippingPaise: totals.shippingPaise,
          codFeePaise: totals.codFeePaise,
          taxPaise: totals.taxPaise,
          totalPaise: totals.totalPaise,
          pricesIncludeTax: settings.pricesIncludeTax,
          taxRemittedBy: settings.taxRemittedBy,
          couponId: coupon?.id ?? null,
          couponCode: coupon?.code ?? null,
          shippingRateId: rate.id,
          shippingMethodName: rate.name,
          customerNote,
          accessTokenHash: hashToken(randomToken()),
          reservationExpiresAt: status === "PENDING" && paymentMethod === "ONLINE" ? addMinutes(placedAt, settings.paymentTimeoutMinutes) : null,
          placedAt,
          ipAddress: `49.${rng.int(32, 47)}.${rng.int(0, 255)}.${rng.int(1, 254)}`,
          userAgent: isManual ? null : rng.pick(USER_AGENTS),
          createdById: isManual ? actor : null,
          createdAt: placedAt,
          addresses: {
            create: [
              {
                type: "SHIPPING",
                fullName: shipping.fullName,
                phone: shipping.phone ?? customer?.phone ?? "+919999999999",
                email: customer?.email ?? guestEmail,
                line1: shipping.line1,
                line2: shipping.line2,
                landmark: shipping.landmark,
                city: shipping.city,
                state: shipping.state,
                pinCode: shipping.pinCode,
                country: "IN",
              },
              ...(billing
                ? [
                    {
                      type: "BILLING",
                      fullName: billing.fullName,
                      phone: billing.phone ?? customer?.phone ?? "+919999999999",
                      email: customer?.email ?? guestEmail,
                      line1: billing.line1,
                      line2: billing.line2,
                      landmark: billing.landmark,
                      city: billing.city,
                      state: billing.state,
                      pinCode: billing.pinCode,
                      country: "IN",
                    },
                  ]
                : []),
            ],
          },
        },
      });
      await tx.orderItem.createMany({ data: items });
      event("STATUS_CHANGE", `Order placed ${isManual ? "manually by an admin" : "via the storefront"} · ${paymentMethod === "COD" ? "cash on delivery" : "online payment"}`, placedAt, {
        fromStatus: null,
        toStatus: "PENDING",
        actorId: isManual ? actor : null,
        metadata: { source: isManual ? "MANUAL" : "STOREFRONT", items: lines.length, couponCode: coupon?.code ?? null },
      });
      if (customerNote) event("NOTE", `Customer note: ${customerNote}`, addMinutes(placedAt, 0.1));

      // Conservative availability for planning (see the module comment).
      for (const line of lines) line.variant.available -= line.quantity;

      // ---- payments (B6) ----------------------------------------------------------------------
      const payments: Prisma.OrderPaymentCreateManyInput[] = [];
      const onlineMethod = rng.weighted([["UPI", 50], ["CARD", 30], ["NETBANKING", 12], ["WALLET", 8]] as const);
      let paidPaise = 0;
      if (paymentMethod === "ONLINE") {
        const paymentSucceeds = outcome === "FLOW" ? stage !== "PENDING" : outcome === "CANCELLED" && !cancelBeforeConfirm;
        const failedAttempts = outcome === "FAILED" ? rng.int(1, 2) : rng.chance(0.25) ? 1 : 0;
        for (let f = 1; f <= failedAttempts; f += 1) {
          const at = addMinutes(placedAt, f * 1.2);
          payments.push({
            id: demoId("pay", n, `f${f}`),
            orderId: id,
            provider: "MOCK",
            providerOrderId: `order_demo_${n}`,
            providerPaymentId: `pay_demo_${n}_f${f}`,
            method: onlineMethod,
            type: "CHARGE",
            status: "FAILED",
            amountPaise: totals.totalPaise,
            failureCode: rng.pick(["BANK_DECLINED", "INSUFFICIENT_FUNDS", "USER_CANCELLED"]),
            failureMessage: rng.pick(["Declined by the issuing bank", "Insufficient funds", "Customer closed the payment window"]),
            rawPayload: { mock: true, attempt: f },
            createdAt: at,
            updatedAt: at,
          });
          event("PAYMENT", `Payment attempt failed (${onlineMethod}) · ${formatInr(totals.totalPaise)}`, at, { metadata: { provider: "MOCK", attempt: f } });
        }
        if (paymentSucceeds) {
          payments.push({
            id: demoId("pay", n, 1),
            orderId: id,
            provider: "MOCK",
            providerOrderId: `order_demo_${n}`,
            providerPaymentId: `pay_demo_${n}`,
            method: onlineMethod,
            type: "CHARGE",
            status: "SUCCEEDED",
            amountPaise: totals.totalPaise,
            rawPayload: { mock: true, method: onlineMethod },
            capturedAt: timeline.payAt,
            createdAt: timeline.payAt,
            updatedAt: timeline.payAt,
          });
          paidPaise += totals.totalPaise;
          event("PAYMENT", `Payment of ${formatInr(totals.totalPaise)} received via ${onlineMethod} (MOCK · pay_demo_${n})`, timeline.payAt, { metadata: { provider: "MOCK", providerPaymentId: `pay_demo_${n}` } });
        } else if (outcome === "FLOW" && stage === "PENDING") {
          payments.push({
            id: demoId("pay", n, 1),
            orderId: id,
            provider: "MOCK",
            providerOrderId: `order_demo_${n}`,
            method: onlineMethod,
            type: "CHARGE",
            status: "PENDING",
            amountPaise: totals.totalPaise,
            rawPayload: { mock: true },
            createdAt: placedAt,
            updatedAt: placedAt,
          });
        }
      }

      // ---- status timeline -----------------------------------------------------------------------
      const reached = (target: Stage) => STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf(target);
      if (confirmed) {
        event("STATUS_CHANGE", paymentMethod === "ONLINE" ? "Payment confirmed - order confirmed automatically" : isManual ? "Manual COD order confirmed on creation" : "COD order confirmed with the customer by phone", timeline.confirmedAt, {
          fromStatus: "PENDING",
          toStatus: "CONFIRMED",
          actorId: paymentMethod === "ONLINE" ? null : actor,
        });
      }
      if (outcome === "FLOW" && reached("PROCESSING")) {
        event("STATUS_CHANGE", "Seller started preparing the order", timeline.processingAt, { fromStatus: "CONFIRMED", toStatus: "PROCESSING", actorId: actor });
        if (rng.chance(0.3)) event("NOTE", rng.pick(INTERNAL_NOTES), addHours(timeline.processingAt, 1), { isInternal: true, actorId: actor });
      }
      if (outcome === "FLOW" && reached("PACKED")) {
        event("STATUS_CHANGE", "Order packed and ready for pickup", timeline.packedAt, { fromStatus: "PROCESSING", toStatus: "PACKED", actorId: actor });
      }

      // ---- shipments per seller group (C1) ----------------------------------------------------
      let firstShippedAt: Date | null = null;
      let lastDeliveredAt: Date | null = null;
      let announcedStatus: Stage = "PACKED";
      const shippedLineIds = new Set<string>();
      const deliveredLineIds = new Set<string>();
      if (outcome === "FLOW" && reached("SHIPPED")) {
        for (const [g, group] of groups.entries()) {
          if (group.stage === "PACKED") continue;
          const partner = rng.pick(partners);
          const trackingNumber = `${partner.code.slice(0, 3)}${String(rng.int(100000000, 999999999))}${n}`;
          const { seq: shipmentSeq, number: shipmentNumber } = await nextNumber(tx, "Shipment");
          const shipmentId = demoId("ship", n, g + 1);
          const shipmentStatus =
            group.stage === "DELIVERED" ? "DELIVERED" : group.stage === "OUT_FOR_DELIVERY" ? "OUT_FOR_DELIVERY" : group.transitAt <= now ? "IN_TRANSIT" : "SHIPPED";
          const origin = group.sellerId ? `${sellerCity.get(group.sellerId) ?? "Jaipur"}` : "DIY Baazar warehouse, Gurugram";
          const destination = shipping.city;
          const shipmentEvents: Prisma.ShipmentEventCreateManyInput[] = [
            { shipmentId, status: "PACKED", location: origin, message: "Parcel packed and pickup requested", occurredAt: timeline.packedAt, createdAt: timeline.packedAt },
            { shipmentId, status: "SHIPPED", location: origin, message: `Picked up by ${partner.name}`, occurredAt: group.shippedAt, createdAt: group.shippedAt },
          ];
          if (group.transitAt <= now) {
            shipmentEvents.push({ shipmentId, status: "IN_TRANSIT", location: rng.pick(HUBS), message: "In transit to destination hub", occurredAt: group.transitAt, createdAt: group.transitAt });
          }
          if (group.stage === "OUT_FOR_DELIVERY" || group.stage === "DELIVERED") {
            shipmentEvents.push({ shipmentId, status: "OUT_FOR_DELIVERY", location: destination, message: "Out for delivery", occurredAt: group.ofdAt, createdAt: group.ofdAt });
          }
          if (group.stage === "DELIVERED") {
            shipmentEvents.push({ shipmentId, status: "DELIVERED", location: destination, message: rng.pick(["Delivered to the customer", "Delivered - signed by recipient", "Delivered to the security desk"]), occurredAt: group.deliveredAt, createdAt: group.deliveredAt });
          }
          await tx.shipment.create({
            data: {
              id: shipmentId,
              seq: shipmentSeq,
              shipmentNumber,
              orderId: id,
              partnerId: partner.id,
              carrierName: partner.name,
              trackingNumber,
              trackingUrl: partner.trackingUrlTemplate ? partner.trackingUrlTemplate.replace("{tracking}", trackingNumber) : null,
              status: shipmentStatus,
              weightGrams: group.lines.reduce((sum, line) => sum + line.quantity * 400, 0),
              costPaise: 0,
              estimatedDeliveryAt: addHours(group.shippedAt, 24 * 5),
              shippedAt: group.shippedAt,
              deliveredAt: group.stage === "DELIVERED" ? group.deliveredAt : null,
              createdAt: timeline.packedAt,
              items: { create: group.lines.map((line) => ({ orderItemId: demoId("oi", n, line.index + 1), quantity: line.quantity })) },
            },
          });
          await tx.shipmentEvent.createMany({ data: shipmentEvents });

          for (const line of group.lines) shippedLineIds.add(demoId("oi", n, line.index + 1));
          await tx.orderItem.updateMany({
            where: { id: { in: group.lines.map((line) => demoId("oi", n, line.index + 1)) } },
            data: { shippedAt: group.shippedAt, deliveredAt: group.stage === "DELIVERED" ? group.deliveredAt : null },
          });
          firstShippedAt = firstShippedAt ? minDate(firstShippedAt, group.shippedAt) : group.shippedAt;
          event("SHIPMENT", `Shipment ${shipmentNumber} handed to ${partner.name} · tracking ${trackingNumber}`, group.shippedAt, { metadata: { shipmentId, trackingNumber, carrier: partner.name } });
          if (announcedStatus === "PACKED") {
            event("STATUS_CHANGE", "First shipment on its way", group.shippedAt, { fromStatus: "PACKED", toStatus: "SHIPPED" });
            announcedStatus = "SHIPPED";
          }
          if (group.stage === "OUT_FOR_DELIVERY" || group.stage === "DELIVERED") {
            event("SHIPMENT", `Shipment ${shipmentNumber} out for delivery in ${destination}`, group.ofdAt, { metadata: { shipmentId } });
            if (announcedStatus === "SHIPPED" && stage === "OUT_FOR_DELIVERY") {
              event("STATUS_CHANGE", "Out for delivery", group.ofdAt, { fromStatus: "SHIPPED", toStatus: "OUT_FOR_DELIVERY" });
              announcedStatus = "OUT_FOR_DELIVERY";
            }
          }
          if (group.stage === "DELIVERED") {
            for (const line of group.lines) deliveredLineIds.add(demoId("oi", n, line.index + 1));
            lastDeliveredAt = maxDate(lastDeliveredAt, group.deliveredAt);
            event("SHIPMENT", `Shipment ${shipmentNumber} delivered`, group.deliveredAt, { metadata: { shipmentId } });

            // B6: COD is collected on delivery; the first delivered shipment also carries shipping and the COD fee.
            if (paymentMethod === "COD") {
              const first = payments.every((payment) => payment.provider !== "COD");
              const amount =
                group.lines.reduce((sum, line) => sum + totalsLines[line.index].lineTotalPaise, 0) +
                (first ? totals.shippingPaise + totals.codFeePaise - (freeShippingCoupon ? totals.shippingPaise : 0) : 0);
              payments.push({
                id: demoId("pay", n, `cod${g + 1}`),
                orderId: id,
                provider: "COD",
                method: "CASH",
                type: "CHARGE",
                status: "SUCCEEDED",
                amountPaise: amount,
                rawPayload: { shipmentId, collectedBy: partner.name },
                capturedAt: group.deliveredAt,
                createdAt: group.deliveredAt,
                updatedAt: group.deliveredAt,
              });
              paidPaise += amount;
              event("PAYMENT", `Cash of ${formatInr(amount)} collected on delivery (${partner.name})`, group.deliveredAt, { metadata: { provider: "COD", shipmentId } });
            }
            // B4: earnings are recorded per delivered shipment.
            await recordEarningsForDeliveredItems(tx, shipmentId, actor);
          }
        }
        if (stage === "DELIVERED" && lastDeliveredAt) {
          event("STATUS_CHANGE", "All items delivered", lastDeliveredAt, { fromStatus: announcedStatus === "OUT_FOR_DELIVERY" ? "OUT_FOR_DELIVERY" : "SHIPPED", toStatus: "DELIVERED" });
        }
      }

      // ---- cancellation / failure -------------------------------------------------------------------
      let cancelReason: string | null = null;
      if (outcome === "CANCELLED") {
        cancelReason = cancelBeforeConfirm && paymentMethod === "ONLINE" ? "Payment not confirmed within the window" : rng.pick(CANCEL_REASONS.slice(0, 4));
        event("STATUS_CHANGE", `Order cancelled: ${cancelReason}`, cancelledAt as Date, {
          fromStatus: cancelBeforeConfirm ? "PENDING" : "PROCESSING",
          toStatus: "CANCELLED",
          actorId: cancelBeforeConfirm ? null : actor,
          metadata: { reason: cancelReason, refundDue: paidPaise > 0 },
        });
        if (!cancelBeforeConfirm) event("STATUS_CHANGE", "Seller started preparing the order", timeline.processingAt, { fromStatus: "CONFIRMED", toStatus: "PROCESSING", actorId: actor });
      }
      if (outcome === "FAILED") {
        const failedAt = addMinutes(placedAt, settings.paymentTimeoutMinutes);
        event("SYSTEM", "Payment window expired - reservation released", failedAt, { metadata: { job: "orders.expire_unpaid" } });
        event("STATUS_CHANGE", "Order failed: no successful payment", failedAt, { fromStatus: "PENDING", toStatus: "FAILED" });
      }

      if (payments.length > 0) await tx.orderPayment.createMany({ data: payments });
      await tx.orderEvent.createMany({ data: events });

      // ---- coupon usage --------------------------------------------------------------------------------
      if (coupon) {
        await tx.couponUsage.create({
          data: { couponId: coupon.id, orderId: id, customerId: customer?.id ?? null, discountPaise: totals.couponDiscountPaise, createdAt: placedAt },
        });
        await tx.coupon.update({ where: { id: coupon.id }, data: { usageCount: { increment: 1 } } });
        couponUsage.set(coupon.id, (couponUsage.get(coupon.id) ?? 0) + 1);
      }

      // ---- final order state -------------------------------------------------------------------------
      const fulfillmentStatus =
        shippedLineIds.size === 0 ? "UNFULFILLED" : shippedLineIds.size === lines.length ? "FULFILLED" : "PARTIAL";
      const paymentStatus = derivePaymentStatus({ paidPaise, refundedPaise: 0, totalPaise: totals.totalPaise, orderStatus: status });
      await tx.order.update({
        where: { id },
        data: {
          status,
          paymentStatus,
          fulfillmentStatus,
          confirmedAt: confirmed ? timeline.confirmedAt : null,
          packedAt: outcome === "FLOW" && reached("PACKED") ? timeline.packedAt : null,
          shippedAt: firstShippedAt,
          deliveredAt: stage === "DELIVERED" ? lastDeliveredAt : null,
          cancelledAt: outcome === "CANCELLED" ? cancelledAt : null,
          cancelReason,
          updatedAt: outcome === "CANCELLED" ? (cancelledAt as Date) : lastDeliveredAt ?? firstShippedAt ?? (confirmed ? timeline.confirmedAt : placedAt),
        },
      });
    });

    if (customer) ordersByCustomer.set(customer.id, (ordersByCustomer.get(customer.id) ?? 0) + 1);
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    created += 1;
  }

  const mix = [...statusCounts.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([key, value]) => `${key} ${value}`)
    .join(", ");
  ctx.log(`orders: ${created + skipped} (created ${created}, existing ${skipped}) · ${mix}`);
}

const STAGE_ORDER: Stage[] = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"];
