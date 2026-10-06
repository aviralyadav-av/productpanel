import type { Prisma } from "@prisma/client";

import { ApiError, validationError } from "@/lib/api/errors";
import { isOnSale } from "@/lib/money";
import { promotionUnitPrice } from "@/features/finance/math";
import { loadChargeRules, resolveCommission } from "@/features/finance/service";
import { readSettingBoolean, readSettingNumber, readSettingString } from "@/features/finance/settings-reader";
import { promotionActive } from "@/features/catalog/pricing";
import { validateCouponForCart } from "@/features/coupons/service";
import type { CartLine } from "@/features/coupons/rules";
import { quoteShipping, type ShippingQuote } from "@/features/shipping/service";
import type { QuotedRate } from "@/features/shipping/resolution";
import {
  snapshotAttributes,
  validateCustomizationAnswers,
  type CustomizationAnswers,
  type NormalizedAnswer,
} from "@/features/products/customization";
import { pendingUploadMimeTypes } from "@/features/products/customization-uploads";
import { CUSTOMIZATION_OPTION_SELECT } from "@/features/products/customization-service";

import { priceOrderDraft, type DraftLine, type DraftShipping, type PricedDraft } from "./pricing";

/**
 * The shared re-pricing core (blueprint §11.8, §11.9, §14.B1-B7, D15).
 *
 * Both `POST /api/v1/orders` and the manual order form hand this function a
 * basket and get back exactly what will be written: the client's totals are
 * never trusted. Everything is read through the caller's transaction so the
 * stock check, the coupon usage count and the price the customer is charged
 * come from the same snapshot the order is then written against.
 *
 * No `server-only` / `next/*` imports: the check script and node:test run it
 * as plain tsx.
 */

type Db = Prisma.TransactionClient;

export type DraftLineRequest = {
  key: string;
  productId: string;
  variantId?: string | null;
  quantity: number;
  customization?: CustomizationAnswers | null;
  /** MANUAL only. */
  unitPriceOverridePaise?: number | null;
  overrideReason?: string | null;
};

export type BuildDraftInput = {
  tx: Db;
  source: "STOREFRONT" | "MANUAL";
  items: readonly DraftLineRequest[];
  paymentMethod: "COD" | "ONLINE" | "MANUAL";
  couponCode?: string | null;
  shippingRateId?: string | null;
  /** Null while the manual form has no address yet: shipping is quoted as 0. */
  destination: { pinCode: string; state?: string | null } | null;
  customer: { email?: string | null; customerId?: string | null };
  now?: Date;
};

export type DraftCouponResult = {
  id: string;
  code: string;
  type: string;
  fundedBy: string;
  discountPaise: number;
  freeShipping: boolean;
};

export type DraftWarning = { code: string; message: string };

export type OrderDraft = PricedDraft & {
  pricesIncludeTax: boolean;
  taxRemittedBy: "SELLER" | "PLATFORM";
  coupon: DraftCouponResult | null;
  couponRejection: { reason: string; message: string } | null;
  shipping: DraftShipping & { quote: ShippingQuote | null; rate: QuotedRate | null };
  /** Non-fatal notes for the operator (MANUAL only reaches these). */
  warnings: DraftWarning[];
  /** Per line key: what the service must exchange or attach at commit. */
  files: Record<string, { uploadTokens: string[]; mediaAssetIds: string[]; normalized: NormalizedAnswer[] }>;
  /** Per line key: MANUAL price override note, kept for the timeline. */
  overrides: Record<string, string>;
};

const PRODUCT_SELECT = {
  id: true,
  title: true,
  brand: true,
  status: true,
  deletedAt: true,
  sellerId: true,
  categoryId: true,
  categoryPath: true,
  pricePaise: true,
  salePricePaise: true,
  saleStartsAt: true,
  saleEndsAt: true,
  activePromotionId: true,
  taxRateBps: true,
  hsnCode: true,
  costPaise: true,
  isCustomizable: true,
  minOrderQty: true,
  maxOrderQty: true,
  weightGrams: true,
  seller: { select: { id: true, displayName: true, status: true, deletedAt: true } },
  images: {
    where: { variantId: null },
    orderBy: [{ isPrimary: "desc" }, { position: "asc" }],
    take: 1,
    select: { media: { select: { url: true, thumbnailUrl: true } } },
  },
  variants: {
    where: { deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { position: "asc" }],
    select: {
      id: true,
      name: true,
      sku: true,
      pricePaise: true,
      salePricePaise: true,
      costPaise: true,
      weightGrams: true,
      isActive: true,
      isDefault: true,
      inventory: { select: { onHand: true, reserved: true, available: true, allowBackorder: true } },
      attributeValues: { select: { attribute: { select: { code: true, name: true } }, value: { select: { value: true, label: true } } } },
      images: { orderBy: { position: "asc" }, take: 1, select: { media: { select: { url: true, thumbnailUrl: true } } } },
    },
  },
  customizationOptions: { where: { isActive: true }, orderBy: { position: "asc" }, select: CUSTOMIZATION_OPTION_SELECT },
} satisfies Prisma.ProductSelect;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;

function isPurchasable(product: ProductRow): boolean {
  if (product.status !== "PUBLISHED" || product.deletedAt) return false;
  if (product.sellerId && (!product.seller || product.seller.status !== "ACTIVE" || product.seller.deletedAt)) return false;
  return true;
}

/**
 * Answers may reference media library assets (manual orders). They are folded
 * into `uploadTokens` so the pure validator treats both sources alike; the
 * ids are remembered so the service attaches the assets instead of exchanging
 * PendingUpload rows.
 */
function normaliseAnswers(answers: CustomizationAnswers | null | undefined): { answers: CustomizationAnswers; uploadTokens: string[]; mediaAssetIds: string[] } {
  const out: CustomizationAnswers = {};
  const uploadTokens: string[] = [];
  const mediaAssetIds: string[] = [];
  for (const [optionId, raw] of Object.entries(answers ?? {})) {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const record = raw as { uploadTokens?: string[]; mediaAssetIds?: string[]; value?: string | string[] | boolean };
      const tokens = [...(record.uploadTokens ?? []), ...(record.mediaAssetIds ?? [])];
      uploadTokens.push(...(record.uploadTokens ?? []));
      mediaAssetIds.push(...(record.mediaAssetIds ?? []));
      out[optionId] = { uploadTokens: tokens, value: record.value };
    } else {
      out[optionId] = raw;
    }
  }
  return { answers: out, uploadTokens, mediaAssetIds };
}

export async function buildOrderDraft(input: BuildDraftInput): Promise<OrderDraft> {
  const { tx, source } = input;
  const now = input.now ?? new Date();
  const lenient = source === "MANUAL";
  const errors: Record<string, string> = {};
  const warnings: DraftWarning[] = [];

  if (input.items.length === 0) throw validationError({ items: "Add at least one item." });

  // ---- settings snapshot (E2) -------------------------------------------------------------
  const [pricesIncludeTax, remittedBy, defaultTaxBps, codEnabled, codFeePaise, codMaxPaise, minOrderPaise, chargeRules] = await Promise.all([
    readSettingBoolean(tx, "tax.prices_include_tax"),
    readSettingString(tx, "tax.goods_remitted_by"),
    readSettingNumber(tx, "tax.default_bps"),
    readSettingBoolean(tx, "orders.cod_enabled"),
    readSettingNumber(tx, "orders.cod_fee_paise"),
    readSettingNumber(tx, "orders.cod_max_paise"),
    readSettingNumber(tx, "orders.min_order_paise"),
    loadChargeRules(tx),
  ]);
  const taxRemittedBy: "SELLER" | "PLATFORM" = remittedBy === "PLATFORM" ? "PLATFORM" : "SELLER";

  // ---- catalogue rows ----------------------------------------------------------------------
  const productIds = [...new Set(input.items.map((item) => item.productId))];
  const products = await tx.product.findMany({ where: { id: { in: productIds } }, select: PRODUCT_SELECT });
  const productById = new Map(products.map((product) => [product.id, product]));

  const promotionIds = [...new Set(products.map((product) => product.activePromotionId).filter((id): id is string => Boolean(id)))];
  const promotions = promotionIds.length
    ? await tx.promotion.findMany({
        where: { id: { in: promotionIds } },
        select: {
          id: true,
          discountType: true,
          value: true,
          fundedBy: true,
          appliesTo: true,
          categoryIds: true,
          productIds: true,
          sellerIds: true,
          priority: true,
          startsAt: true,
          endsAt: true,
          isActive: true,
        },
      })
    : [];
  const promotionById = new Map(promotions.filter((promotion) => promotionActive(promotion, now)).map((promotion) => [promotion.id, promotion]));

  // ---- file answers: mime types for validation ------------------------------------------------
  const perLineAnswers = input.items.map((item) => normaliseAnswers(item.customization));
  const allTokens = perLineAnswers.flatMap((entry) => entry.uploadTokens);
  const allAssetIds = perLineAnswers.flatMap((entry) => entry.mediaAssetIds);
  const fileMimeTypes: Record<string, string> = {};
  if (allTokens.length) Object.assign(fileMimeTypes, await pendingUploadMimeTypes(tx, allTokens));
  if (allAssetIds.length) {
    const assets = await tx.mediaAsset.findMany({ where: { id: { in: allAssetIds } }, select: { id: true, mimeType: true } });
    for (const asset of assets) fileMimeTypes[asset.id] = asset.mimeType ?? "application/octet-stream";
    for (const id of allAssetIds) if (!fileMimeTypes[id]) errors[`items.${id}`] = "A picked media asset no longer exists.";
  }

  // ---- lines -------------------------------------------------------------------------------
  const lines: DraftLine[] = [];
  const files: OrderDraft["files"] = {};
  const overrides: Record<string, string> = {};
  const commissionCache = new Map<string, Promise<{ rateBps: number; fixedPaise: number; ruleId: string | null }>>();

  for (const [index, item] of input.items.entries()) {
    const field = (name: string) => `items.${index}.${name}`;
    const product = productById.get(item.productId);
    if (!product || !isPurchasable(product)) {
      errors[field("productId")] = "This product is not available for sale.";
      continue;
    }

    const variant = item.variantId
      ? product.variants.find((row) => row.id === item.variantId)
      : product.variants.find((row) => row.isActive && row.isDefault) ?? product.variants.find((row) => row.isActive);
    if (!variant || !variant.isActive) {
      errors[field("variantId")] = item.variantId ? "That variant is no longer offered." : "This product has no purchasable variant.";
      continue;
    }

    const quantity = Math.trunc(item.quantity);
    if (quantity < Math.max(1, product.minOrderQty)) errors[field("quantity")] = `Minimum order quantity is ${product.minOrderQty}.`;
    if (product.maxOrderQty && quantity > product.maxOrderQty) errors[field("quantity")] = `Maximum order quantity is ${product.maxOrderQty}.`;

    const inventory = variant.inventory;
    const available = inventory ? inventory.available : 0;
    if (!inventory || (!inventory.allowBackorder && available < quantity)) {
      errors[field("quantity")] = available > 0 ? `Only ${available} left in stock.` : "Out of stock.";
    }

    // Customisation (§11.9): validate against the live options, per unit surcharge.
    const answers = perLineAnswers[index];
    let normalized: NormalizedAnswer[] = [];
    let customizationPaise = 0;
    if (product.customizationOptions.length > 0) {
      const validation = validateCustomizationAnswers(product.customizationOptions, answers.answers, { fileMimeTypes });
      if (!validation.ok) {
        errors[field("customization")] = validation.problems.map((problem) => problem.message).join(" ");
      }
      normalized = validation.normalized;
      customizationPaise = validation.priceDeltaPaise;
    }
    files[item.key] = { uploadTokens: answers.uploadTokens, mediaAssetIds: answers.mediaAssetIds, normalized };

    // Price: variant list, sale window, then promotion (B2 promotion first).
    const listPricePaise = variant.pricePaise ?? product.pricePaise;
    const salePaise = variant.salePricePaise ?? (variant.pricePaise === null ? product.salePricePaise : null);
    const saleActive = isOnSale({ pricePaise: listPricePaise, salePricePaise: salePaise, saleStartsAt: product.saleStartsAt, saleEndsAt: product.saleEndsAt, now });
    let unitPricePaise = saleActive && salePaise !== null ? salePaise : listPricePaise;
    let promotionDiscountPaise = 0;
    let promotionFundedBy: "PLATFORM" | "SELLER" | null = null;

    const override = item.unitPriceOverridePaise;
    if (override !== null && override !== undefined) {
      if (source !== "MANUAL") {
        errors[field("unitPriceOverridePaise")] = "Price overrides are not accepted here.";
      } else {
        unitPricePaise = override;
        overrides[item.key] = item.overrideReason ?? "Price adjusted by operator";
      }
    } else {
      const promotion = product.activePromotionId ? promotionById.get(product.activePromotionId) : undefined;
      if (promotion) {
        const promotedUnit = Math.min(unitPricePaise, promotionUnitPrice(listPricePaise, promotion));
        promotionDiscountPaise = Math.max(0, unitPricePaise - promotedUnit) * quantity;
        promotionFundedBy = promotionDiscountPaise > 0 ? (promotion.fundedBy === "SELLER" ? "SELLER" : "PLATFORM") : null;
      }
    }

    // Commission snapshot (B3), one resolution per product.
    let commission = { rateBps: 0, fixedPaise: 0, ruleId: null as string | null };
    if (product.sellerId) {
      let pending = commissionCache.get(product.id);
      if (!pending) {
        pending = resolveCommission(tx, { productId: product.id, sellerId: product.sellerId, categoryId: product.categoryId, categoryPath: product.categoryPath, now }).then(
          (resolved) => ({ rateBps: resolved.rateBps, fixedPaise: resolved.fixedPaise, ruleId: resolved.ruleId }),
        );
        commissionCache.set(product.id, pending);
      }
      commission = await pending;
    }

    const image = variant.images[0]?.media ?? product.images[0]?.media ?? null;

    lines.push({
      key: item.key,
      productId: product.id,
      variantId: variant.id,
      sellerId: product.sellerId,
      categoryId: product.categoryId,
      titleSnapshot: product.title,
      variantSnapshot: variant.name === "Default" ? null : variant.name,
      skuSnapshot: variant.sku,
      sellerNameSnapshot: product.seller?.displayName ?? null,
      categoryPathSnapshot: product.categoryPath,
      hsnCodeSnapshot: product.hsnCode,
      brandSnapshot: product.brand,
      costPaiseSnapshot: variant.costPaise ?? product.costPaise,
      imageUrl: image?.thumbnailUrl ?? image?.url ?? null,
      attributesSnapshot: snapshotAttributes(variant.attributeValues),
      customization: null,
      listPricePaise,
      unitPricePaise,
      customizationPaise,
      quantity,
      promotionDiscountPaise,
      promotionFundedBy,
      taxRateBps: product.taxRateBps ?? defaultTaxBps,
      commission,
    });
  }

  if (Object.keys(errors).length > 0) throw validationError(errors, "Some items cannot be ordered as entered.");

  // ---- coupon (B2 second, §11.8 same rules as /coupons/validate) -----------------------------
  const cartLines: CartLine[] = lines.map((line) => ({
    productId: line.productId,
    variantId: line.variantId,
    sellerId: line.sellerId,
    categoryId: line.categoryId,
    categoryPath: line.categoryPathSnapshot,
    quantity: line.quantity,
    unitPricePaise: line.unitPricePaise,
    customizationPaise: line.customizationPaise,
    promotionDiscountPaise: line.promotionDiscountPaise,
  }));
  const promotedSubtotal = lines.reduce((sum, line) => sum + (line.unitPricePaise + line.customizationPaise) * line.quantity - line.promotionDiscountPaise, 0);

  let coupon: OrderDraft["coupon"] = null;
  let couponRejection: OrderDraft["couponRejection"] = null;
  let couponForPricing: Parameters<typeof priceOrderDraft>[1]["coupon"] = null;
  if (input.couponCode) {
    const evaluation = await validateCouponForCart({
      code: input.couponCode,
      lines: cartLines,
      customerEmail: input.customer.email ?? null,
      customerId: input.customer.customerId ?? null,
      subtotalPaise: promotedSubtotal,
      now,
      tx,
    });
    if (evaluation.ok) {
      coupon = {
        id: evaluation.coupon.id,
        code: evaluation.coupon.code,
        type: evaluation.coupon.type,
        fundedBy: evaluation.coupon.fundedBy,
        discountPaise: evaluation.discountPaise,
        freeShipping: evaluation.freeShipping,
      };
      couponForPricing = {
        id: coupon.id,
        code: coupon.code,
        type: coupon.type,
        fundedBy: coupon.fundedBy,
        perLine: evaluation.perLine.map((entry) => entry.discountPaise),
        freeShipping: evaluation.freeShipping,
      };
    } else {
      couponRejection = { reason: evaluation.reason, message: evaluation.message };
    }
  }

  // ---- shipping (B7) -----------------------------------------------------------------------
  const preliminary = priceOrderDraft(lines, {
    pricesIncludeTax,
    taxRemittedBy,
    paymentMethod: input.paymentMethod,
    coupon: couponForPricing,
    shipping: { rateId: null, methodName: null, ratePaise: 0, codFeePaise: 0, estimatedDeliveryAt: null },
    chargeRules,
  });

  let quote: ShippingQuote | null = null;
  let rate: QuotedRate | null = null;
  if (input.destination) {
    quote = await quoteShipping(
      {
        pinCode: input.destination.pinCode,
        state: input.destination.state ?? null,
        items: preliminary.lines.map((line) => ({
          variantId: line.variantId,
          productId: line.productId,
          quantity: line.quantity,
          lineTotalPaise: line.lineGross - line.promotionDiscountPaise - line.couponDiscountPaise,
        })),
        discountedSubtotalPaise: preliminary.discountedSubtotalPaise,
        paymentMethod: input.paymentMethod,
        now,
      },
      tx,
    );
    rate = (input.shippingRateId ? quote.rates.find((row) => row.rateId === input.shippingRateId) : undefined) ?? quote.rates.find((row) => row.rateId === quote?.defaultRateId) ?? quote.rates[0] ?? null;
    if (input.shippingRateId && quote.rates.length > 0 && !quote.rates.some((row) => row.rateId === input.shippingRateId)) {
      if (!lenient) throw validationError({ shippingRateId: "That shipping option is not available for this address." });
      warnings.push({ code: "RATE_FALLBACK", message: "The chosen shipping option is unavailable; the default rate was used." });
    }
    if (!rate) {
      const why = quote.reasons.includes("pincode_not_serviceable") || quote.reasons.includes("no_zone") ? "We do not deliver to this PIN code." : "No shipping option covers this order.";
      if (!lenient) throw validationError({ "shippingAddress.pinCode": why });
      warnings.push({ code: "NOT_SERVICEABLE", message: `${why} Shipping was set to zero; adjust manually if needed.` });
    }
  } else if (!lenient) {
    throw validationError({ "shippingAddress.pinCode": "A delivery address is required." });
  } else {
    warnings.push({ code: "NO_ADDRESS", message: "Enter a delivery address to quote shipping." });
  }

  const isCod = input.paymentMethod === "COD";
  if (isCod && !codEnabled) throw validationError({ paymentMethod: "Cash on delivery is switched off." });
  if (isCod && rate && !rate.codAvailable) {
    if (!lenient) throw validationError({ paymentMethod: "Cash on delivery is not available for this address." });
    warnings.push({ code: "COD_UNAVAILABLE", message: "COD is not offered for this address; the order is accepted anyway." });
  }

  const shipping: DraftShipping = {
    rateId: rate?.rateId ?? null,
    methodName: rate?.name ?? null,
    ratePaise: rate?.ratePaise ?? 0,
    codFeePaise: isCod ? (rate ? rate.codFeePaise || codFeePaise : codFeePaise) : 0,
    estimatedDeliveryAt: rate?.estimatedDeliveryAt ?? null,
  };

  const priced = priceOrderDraft(lines, { pricesIncludeTax, taxRemittedBy, paymentMethod: input.paymentMethod, coupon: couponForPricing, shipping, chargeRules });

  // ---- order-level rules (D15, E2) --------------------------------------------------------
  if (isCod && codMaxPaise > 0 && priced.totals.totalPaise > codMaxPaise) {
    if (!lenient) throw validationError({ paymentMethod: "This order is above the cash-on-delivery limit; pay online instead." });
    warnings.push({ code: "COD_LIMIT", message: "Order total is above the COD limit." });
  }
  if (!lenient && minOrderPaise > 0 && priced.discountedSubtotalPaise < minOrderPaise) {
    throw new ApiError(422, "VALIDATION_ERROR", "The order is below the minimum order value.", { items: "Below the minimum order value." });
  }
  if (priced.totals.totalPaise < 0) throw validationError({ items: "Totals cannot be negative." });

  return {
    ...priced,
    pricesIncludeTax,
    taxRemittedBy,
    coupon,
    couponRejection,
    shipping: { ...shipping, quote, rate },
    warnings,
    files,
    overrides,
  };
}
