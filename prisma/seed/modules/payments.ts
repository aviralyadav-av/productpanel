import type { PrismaClient } from "@prisma/client";

import type { SeedContext } from "./context";

/**
 * Payment providers (COD, MANUAL and MOCK enabled; gateways as disabled
 * placeholders - credentials are entered in Settings and encrypted, D4),
 * shipping partners with tracking URL templates, and a default "All India"
 * zone with STANDARD and EXPRESS rates.
 *
 * Provider enablement and rates are the admin's to change, so re-seeding only
 * asserts presence.
 */
const PROVIDERS = [
  { provider: "COD", displayName: "Cash on Delivery", isEnabled: true, mode: "LIVE", supportedMethods: ["COD"], position: 0 },
  { provider: "MANUAL", displayName: "Manual / offline payment", isEnabled: true, mode: "LIVE", supportedMethods: ["BANK_TRANSFER", "CASH", "UPI", "OTHER"], position: 1 },
  { provider: "MOCK", displayName: "Mock gateway (testing)", isEnabled: true, mode: "TEST", supportedMethods: ["UPI", "CARD", "NETBANKING", "WALLET"], position: 2 },
  { provider: "RAZORPAY", displayName: "Razorpay", isEnabled: false, mode: "TEST", supportedMethods: ["UPI", "CARD", "NETBANKING", "WALLET"], position: 3 },
  { provider: "STRIPE", displayName: "Stripe", isEnabled: false, mode: "TEST", supportedMethods: ["CARD"], position: 4 },
  { provider: "PAYU", displayName: "PayU", isEnabled: false, mode: "TEST", supportedMethods: ["UPI", "CARD", "NETBANKING"], position: 5 },
  { provider: "PHONEPE", displayName: "PhonePe", isEnabled: false, mode: "TEST", supportedMethods: ["UPI", "WALLET"], position: 6 },
];

const PARTNERS = [
  { code: "DELHIVERY", name: "Delhivery", trackingUrlTemplate: "https://www.delhivery.com/track/package/{tracking}", website: "https://www.delhivery.com", position: 0 },
  { code: "BLUEDART", name: "Blue Dart", trackingUrlTemplate: "https://www.bluedart.com/tracking?trackFor=0&trackNo={tracking}", website: "https://www.bluedart.com", position: 1 },
  { code: "DTDC", name: "DTDC", trackingUrlTemplate: "https://www.dtdc.in/tracking.asp?strCnno={tracking}", website: "https://www.dtdc.in", position: 2 },
  { code: "INDIAPOST", name: "India Post", trackingUrlTemplate: "https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx?cn={tracking}", website: "https://www.indiapost.gov.in", position: 3 },
];

export async function seedPayments(db: PrismaClient, ctx: SeedContext) {
  for (const provider of PROVIDERS) {
    await db.paymentProviderConfig.upsert({
      where: { provider: provider.provider },
      update: { displayName: provider.displayName, position: provider.position },
      create: { ...provider, credentialsEnc: {}, settings: {} },
    });
  }
  ctx.log(`payment providers: ${PROVIDERS.length}`);

  for (const partner of PARTNERS) {
    await db.shippingPartner.upsert({
      where: { code: partner.code },
      update: { trackingUrlTemplate: partner.trackingUrlTemplate },
      create: { ...partner, isActive: true },
    });
  }
  ctx.log(`shipping partners: ${PARTNERS.length}`);

  let zone = await db.shippingZone.findFirst({ where: { isDefault: true }, select: { id: true } });
  if (!zone) {
    zone = await db.shippingZone.create({
      data: {
        name: "All India",
        description: "Default zone covering every serviceable pincode.",
        countries: ["IN"],
        isDefault: true,
        isActive: true,
        position: 0,
      },
      select: { id: true },
    });
  }

  if ((await db.shippingRate.count({ where: { zoneId: zone.id } })) === 0) {
    await db.shippingRate.createMany({
      data: [
        {
          zoneId: zone.id,
          name: "Standard delivery",
          method: "STANDARD",
          ratePaise: 7900,
          freeAbovePaise: null, // falls back to settings shipping.free_above_paise (B7)
          codAvailable: true,
          codFeePaise: 0, // COD fee comes from settings orders.cod_fee_paise
          estimatedDaysMin: 4,
          estimatedDaysMax: 8,
          isActive: true,
          position: 0,
        },
        {
          zoneId: zone.id,
          name: "Express delivery",
          method: "EXPRESS",
          ratePaise: 19900,
          freeAbovePaise: null,
          codAvailable: false,
          codFeePaise: 0,
          estimatedDaysMin: 2,
          estimatedDaysMax: 4,
          isActive: true,
          position: 1,
        },
      ],
    });
  }
  ctx.log(`shipping zones: ${await db.shippingZone.count()}, rates: ${await db.shippingRate.count()}`);
}
