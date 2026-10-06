"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";
import { pincodeSchema } from "@/lib/validation";

import {
  partnerInputSchema,
  pincodeBulkSchema,
  pincodeInputSchema,
  pincodeUpdateSchema,
  quoteRequestSchema,
  rateInputSchema,
  reorderSchema,
  shippingIdSchema,
  zoneInputSchema,
  type PartnerInput,
  type PincodeBulkInput,
  type PincodeInput,
  type RateInput,
  type ZoneInput,
} from "@/features/shipping/schemas";
import {
  bulkUpdatePincodes,
  createPartner,
  createRate,
  createZone,
  deletePartner,
  deletePincode,
  deleteRate,
  deleteZone,
  priceQuoteItems,
  quoteShipping,
  reorderZones,
  setPartnerActive,
  setRateActive,
  updatePartner,
  updatePincode,
  updateRate,
  updateZone,
  upsertPincode,
  type BulkPincodeResult,
  type ShippingQuote,
} from "@/features/shipping/service";

/**
 * Server Actions behind /admin/shipping. Thin: permission → zod → service
 * (transaction + audit) → revalidate → ActionResult. CSV import and export
 * go through the REST routes instead because they move files.
 *
 * No `invalidatePublic()` here on purpose: the public shipping endpoints are
 * computed per request behind CDN max-age headers, not Next cache tags, and
 * `listTagsFor("shipping")` would fall back to invalidating EVERY public tag.
 */

const SHIPPING_PATH = "/admin/shipping";

function revalidate(): void {
  revalidatePath(SHIPPING_PATH);
}

const MANAGE = "shipping.manage";

type Id = { id: string; name: string };

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

export async function createZoneAction(input: ZoneInput): Promise<ActionResult<Id>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsed = zoneInputSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const zone = await createZone(parsed.data, actor);
    revalidate();
    return ok({ id: zone.id, name: zone.name }, `Zone "${zone.name}" created.`);
  });
}

export async function updateZoneAction(id: string, input: ZoneInput): Promise<ActionResult<Id>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsedId = shippingIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid zone id.");
    const parsed = zoneInputSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const zone = await updateZone(parsedId.data, parsed.data, actor);
    revalidate();
    return ok({ id: zone.id, name: zone.name }, `Zone "${zone.name}" saved.`);
  });
}

export async function deleteZoneAction(id: string): Promise<ActionResult<Id>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsedId = shippingIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid zone id.");
    const zone = await deleteZone(parsedId.data, actor);
    revalidate();
    return ok(zone, `Zone "${zone.name}" deleted.`);
  });
}

export async function reorderZonesAction(ids: string[]): Promise<ActionResult<{ moved: number }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsed = reorderSchema.safeParse({ ids });
    if (!parsed.success) return zodFail(parsed.error);
    const result = await reorderZones(parsed.data.ids, actor);
    revalidate();
    return ok(result);
  });
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

export async function createRateAction(input: RateInput): Promise<ActionResult<Id>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsed = rateInputSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const rate = await createRate(parsed.data, actor);
    revalidate();
    return ok({ id: rate.id, name: rate.name }, `Rate "${rate.name}" created.`);
  });
}

export async function updateRateAction(id: string, input: RateInput): Promise<ActionResult<Id>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsedId = shippingIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid rate id.");
    const parsed = rateInputSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const rate = await updateRate(parsedId.data, parsed.data, actor);
    revalidate();
    return ok({ id: rate.id, name: rate.name }, `Rate "${rate.name}" saved.`);
  });
}

export async function setRateActiveAction(id: string, isActive: boolean): Promise<ActionResult<Id>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsedId = shippingIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid rate id.");
    const rate = await setRateActive(parsedId.data, Boolean(isActive), actor);
    revalidate();
    return ok({ id: rate.id, name: rate.name }, `Rate "${rate.name}" ${rate.isActive ? "enabled" : "disabled"}.`);
  });
}

export async function deleteRateAction(id: string): Promise<ActionResult<Id>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsedId = shippingIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid rate id.");
    const rate = await deleteRate(parsedId.data, actor);
    revalidate();
    return ok(rate, `Rate "${rate.name}" deleted.`);
  });
}

// ---------------------------------------------------------------------------
// Partners
// ---------------------------------------------------------------------------

export async function createPartnerAction(input: PartnerInput): Promise<ActionResult<Id>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsed = partnerInputSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const partner = await createPartner(parsed.data, actor);
    revalidate();
    return ok({ id: partner.id, name: partner.name }, `Partner "${partner.name}" added.`);
  });
}

export async function updatePartnerAction(id: string, input: PartnerInput): Promise<ActionResult<Id>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsedId = shippingIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid partner id.");
    const parsed = partnerInputSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const partner = await updatePartner(parsedId.data, parsed.data, actor);
    revalidate();
    return ok({ id: partner.id, name: partner.name }, `Partner "${partner.name}" saved.`);
  });
}

export async function setPartnerActiveAction(id: string, isActive: boolean): Promise<ActionResult<Id>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsedId = shippingIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid partner id.");
    const partner = await setPartnerActive(parsedId.data, Boolean(isActive), actor);
    revalidate();
    return ok({ id: partner.id, name: partner.name }, `Partner "${partner.name}" ${partner.isActive ? "enabled" : "disabled"}.`);
  });
}

export async function deletePartnerAction(id: string): Promise<ActionResult<Id>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsedId = shippingIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid partner id.");
    const partner = await deletePartner(parsedId.data, actor);
    revalidate();
    return ok(partner, `Partner "${partner.name}" deleted.`);
  });
}

// ---------------------------------------------------------------------------
// Pincodes
// ---------------------------------------------------------------------------

export async function upsertPincodeAction(input: PincodeInput): Promise<ActionResult<{ pincode: string; created: boolean }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsed = pincodeInputSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await upsertPincode(parsed.data, actor);
    revalidate();
    return ok({ pincode: result.row.pincode, created: result.created }, `Pincode ${result.row.pincode} ${result.created ? "added" : "updated"}.`);
  });
}

export async function updatePincodeAction(pincode: string, input: Omit<PincodeInput, "pincode">): Promise<ActionResult<{ pincode: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsedPin = pincodeSchema.safeParse(pincode);
    if (!parsedPin.success) return fail("Invalid pincode.");
    const parsed = pincodeUpdateSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await updatePincode(parsedPin.data, parsed.data, actor);
    revalidate();
    return ok({ pincode: row.pincode }, `Pincode ${row.pincode} updated.`);
  });
}

export async function deletePincodeAction(pincode: string): Promise<ActionResult<{ pincode: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsedPin = pincodeSchema.safeParse(pincode);
    if (!parsedPin.success) return fail("Invalid pincode.");
    const result = await deletePincode(parsedPin.data, actor);
    revalidate();
    return ok(result, `Pincode ${result.pincode} removed.`);
  });
}

export async function bulkPincodesAction(input: PincodeBulkInput): Promise<ActionResult<BulkPincodeResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsed = pincodeBulkSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await bulkUpdatePincodes(parsed.data, actor);
    revalidate();
    return ok(result, `Updated ${result.updated} of ${result.requested} pincodes.`);
  });
}

// ---------------------------------------------------------------------------
// Quote preview (read-only; shipping.view)
// ---------------------------------------------------------------------------

export type QuotePreviewInput = {
  pinCode: string;
  state?: string;
  items: Array<{ productId?: string; variantId?: string; quantity: number }>;
  paymentMethod?: "COD" | "ONLINE" | "MANUAL";
  discountedSubtotalPaise?: number;
};

export async function quotePreviewAction(input: QuotePreviewInput): Promise<ActionResult<ShippingQuote & { subtotalPaise: number; missing: string[] }>> {
  return runAction(async () => {
    await requirePermissionOrThrow("shipping.view");
    const parsed = quoteRequestSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const priced = await priceQuoteItems(parsed.data.items);
    if (priced.items.length === 0) return fail("None of those items exist in the catalogue.");
    const quote = await quoteShipping({
      pinCode: parsed.data.pinCode,
      state: parsed.data.state,
      items: priced.items,
      discountedSubtotalPaise: parsed.data.discountedSubtotalPaise ?? priced.subtotalPaise,
      paymentMethod: parsed.data.paymentMethod,
    });
    return ok({ ...quote, subtotalPaise: priced.subtotalPaise, missing: priced.missing });
  });
}
