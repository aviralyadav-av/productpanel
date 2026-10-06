import type { PincodeServiceability, Prisma, ShippingPartner } from "@prisma/client";

import { conflict, notFound } from "@/lib/api/errors";
import { diffOf, writeAudit } from "@/lib/audit";

import { canonicalStateName } from "@/features/shipping/india";
import type { PartnerData, PincodeBulkData, PincodeData, PincodeUpdate } from "@/features/shipping/schemas";
import { run, type ClientInfo, type Db, type ShippingActor } from "@/features/shipping/service";

/**
 * Shipping partners and pincode rows (blueprint §4.6). Split out of
 * service.ts only for file size; service.ts re-exports everything here so
 * consumers keep one import path.
 */

// ---------------------------------------------------------------------------
// Partners
// ---------------------------------------------------------------------------

const partnerAudit = (partner: ShippingPartner): Record<string, unknown> => {
  const { id: _id, ...rest } = partner;
  void _id;
  return rest;
};

export async function createPartner(data: PartnerData, actor: ShippingActor, client: ClientInfo = {}, tx?: Db): Promise<ShippingPartner> {
  return run(tx, async (t) => {
    const clash = await t.shippingPartner.findUnique({ where: { code: data.code }, select: { id: true } });
    if (clash) throw conflict(`A partner with code ${data.code} already exists.`, { code: "Already in use." });
    const partner = await t.shippingPartner.create({ data });
    await writeAudit(t, {
      actor,
      action: "shipping_partner.create",
      entityType: "ShippingPartner",
      entityId: partner.id,
      entityLabel: partner.name,
      summary: `Added shipping partner "${partner.name}" (${partner.code}).`,
      diff: diffOf(null, partnerAudit(partner)),
      ...client,
    });
    return partner;
  });
}

export async function updatePartner(id: string, data: PartnerData, actor: ShippingActor, client: ClientInfo = {}, tx?: Db): Promise<ShippingPartner> {
  return run(tx, async (t) => {
    const before = await t.shippingPartner.findUnique({ where: { id } });
    if (!before) throw notFound("Shipping partner");
    if (data.code !== before.code) {
      const clash = await t.shippingPartner.findUnique({ where: { code: data.code }, select: { id: true } });
      if (clash) throw conflict(`A partner with code ${data.code} already exists.`, { code: "Already in use." });
    }
    const partner = await t.shippingPartner.update({ where: { id }, data });
    await writeAudit(t, {
      actor,
      action: "shipping_partner.update",
      entityType: "ShippingPartner",
      entityId: id,
      entityLabel: partner.name,
      summary: `Updated shipping partner "${partner.name}".`,
      diff: diffOf(partnerAudit(before), partnerAudit(partner)),
      ...client,
    });
    return partner;
  });
}

export async function setPartnerActive(id: string, isActive: boolean, actor: ShippingActor, client: ClientInfo = {}, tx?: Db): Promise<ShippingPartner> {
  return run(tx, async (t) => {
    const before = await t.shippingPartner.findUnique({ where: { id } });
    if (!before) throw notFound("Shipping partner");
    const partner = await t.shippingPartner.update({ where: { id }, data: { isActive } });
    await writeAudit(t, {
      actor,
      action: "shipping_partner.update",
      entityType: "ShippingPartner",
      entityId: id,
      entityLabel: partner.name,
      summary: `${isActive ? "Enabled" : "Disabled"} shipping partner "${partner.name}".`,
      diff: diffOf({ isActive: before.isActive }, { isActive }),
      ...client,
    });
    return partner;
  });
}

export async function deletePartner(id: string, actor: ShippingActor, client: ClientInfo = {}, tx?: Db): Promise<{ id: string; name: string }> {
  return run(tx, async (t) => {
    const partner = await t.shippingPartner.findUnique({ where: { id }, include: { _count: { select: { shipments: true, returnPickups: true } } } });
    if (!partner) throw notFound("Shipping partner");
    const references = partner._count.shipments + partner._count.returnPickups;
    if (references > 0) {
      throw conflict(
        `"${partner.name}" is referenced by ${partner._count.shipments} shipment${partner._count.shipments === 1 ? "" : "s"}${partner._count.returnPickups ? ` and ${partner._count.returnPickups} return pickup${partner._count.returnPickups === 1 ? "" : "s"}` : ""}. Disable it instead.`,
      );
    }
    await t.shippingPartner.delete({ where: { id } });
    await writeAudit(t, {
      actor,
      action: "shipping_partner.delete",
      entityType: "ShippingPartner",
      entityId: id,
      entityLabel: partner.name,
      summary: `Deleted shipping partner "${partner.name}" (${partner.code}).`,
      diff: diffOf(partnerAudit(partner), null),
      ...client,
    });
    return { id, name: partner.name };
  });
}

// ---------------------------------------------------------------------------
// Pincodes (single and bulk; CSV import lives in pincode-import.ts)
// ---------------------------------------------------------------------------

const pincodeAudit = (row: PincodeServiceability): Record<string, unknown> => ({
  city: row.city,
  state: row.state,
  zoneId: row.zoneId,
  isServiceable: row.isServiceable,
  codAvailable: row.codAvailable,
  estimatedDays: row.estimatedDays,
});

async function assertZoneExists(t: Prisma.TransactionClient, zoneId: string | null | undefined): Promise<void> {
  if (!zoneId) return;
  const zone = await t.shippingZone.findUnique({ where: { id: zoneId }, select: { id: true } });
  if (!zone) throw notFound("Shipping zone");
}

/** Create or fully replace one pincode row (the "add pincode" dialog and POST /pincodes). */
export async function upsertPincode(data: PincodeData, actor: ShippingActor, client: ClientInfo = {}, tx?: Db): Promise<{ row: PincodeServiceability; created: boolean }> {
  return run(tx, async (t) => {
    await assertZoneExists(t, data.zoneId);
    const before = await t.pincodeServiceability.findUnique({ where: { pincode: data.pincode } });
    const values = { ...data, state: canonicalStateName(data.state) };
    const row = before
      ? await t.pincodeServiceability.update({ where: { pincode: data.pincode }, data: values })
      : await t.pincodeServiceability.create({ data: values });
    await writeAudit(t, {
      actor,
      action: before ? "pincode.update" : "pincode.create",
      entityType: "PincodeServiceability",
      entityId: row.pincode,
      entityLabel: row.pincode,
      summary: `${before ? "Updated" : "Added"} pincode ${row.pincode}${row.city ? ` (${row.city})` : ""}.`,
      diff: diffOf(before ? pincodeAudit(before) : null, pincodeAudit(row)),
      ...client,
    });
    return { row, created: !before };
  });
}

export async function updatePincode(pincode: string, patch: PincodeUpdate, actor: ShippingActor, client: ClientInfo = {}, tx?: Db): Promise<PincodeServiceability> {
  return run(tx, async (t) => {
    const before = await t.pincodeServiceability.findUnique({ where: { pincode } });
    if (!before) throw notFound("Pincode");
    await assertZoneExists(t, patch.zoneId);
    const row = await t.pincodeServiceability.update({
      where: { pincode },
      data: { ...patch, ...(patch.state !== undefined ? { state: canonicalStateName(patch.state) } : {}) },
    });
    await writeAudit(t, {
      actor,
      action: "pincode.update",
      entityType: "PincodeServiceability",
      entityId: pincode,
      entityLabel: pincode,
      summary: `Updated pincode ${pincode}.`,
      diff: diffOf(pincodeAudit(before), pincodeAudit(row)),
      ...client,
    });
    return row;
  });
}

export async function deletePincode(pincode: string, actor: ShippingActor, client: ClientInfo = {}, tx?: Db): Promise<{ pincode: string }> {
  return run(tx, async (t) => {
    const before = await t.pincodeServiceability.findUnique({ where: { pincode } });
    if (!before) throw notFound("Pincode");
    await t.pincodeServiceability.delete({ where: { pincode } });
    await writeAudit(t, {
      actor,
      action: "pincode.delete",
      entityType: "PincodeServiceability",
      entityId: pincode,
      entityLabel: pincode,
      summary: `Deleted pincode ${pincode}; it now follows zone prefix/state/default rules.`,
      diff: diffOf(pincodeAudit(before), null),
      ...client,
    });
    return { pincode };
  });
}

export type BulkPincodeResult = { action: PincodeBulkData["action"]; requested: number; updated: number };

/** §11.33: one transaction, one audit row carrying the id count. */
export async function bulkUpdatePincodes(input: PincodeBulkData, actor: ShippingActor, client: ClientInfo = {}, tx?: Db): Promise<BulkPincodeResult> {
  return run(tx, async (t) => {
    const data: Prisma.PincodeServiceabilityUncheckedUpdateManyInput =
      input.action === "serviceable_on"
        ? { isServiceable: true }
        : input.action === "serviceable_off"
          ? { isServiceable: false }
          : input.action === "cod_on"
            ? { codAvailable: true }
            : input.action === "cod_off"
              ? { codAvailable: false }
              : { zoneId: input.zoneId ?? null };
    if (input.action === "assign_zone") await assertZoneExists(t, input.zoneId);

    const result = await t.pincodeServiceability.updateMany({ where: { pincode: { in: [...input.pincodes] } }, data });
    await writeAudit(t, {
      actor,
      action: "pincode.bulk_update",
      entityType: "PincodeServiceability",
      summary: `Bulk ${input.action.replace("_", " ")} on ${result.count} of ${input.pincodes.length} pincodes.`,
      diff: { action: input.action, zoneId: input.zoneId ?? null, requested: input.pincodes.length, updated: result.count },
      ...client,
    });
    return { action: input.action, requested: input.pincodes.length, updated: result.count };
  });
}
