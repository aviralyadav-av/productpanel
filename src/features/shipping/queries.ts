import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";

import type { PincodeListFilters, PincodeSort } from "@/features/shipping/schemas";

/**
 * Read side of /admin/shipping. Server Components and the REST list routes
 * call these; filters arrive already parsed from the URL so the page and
 * `GET /api/admin/shipping/pincodes` speak the same vocabulary.
 */

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

export type ZoneRow = {
  id: string;
  name: string;
  description: string | null;
  countries: string[];
  states: string[];
  pincodePrefixes: string[];
  isDefault: boolean;
  isActive: boolean;
  position: number;
  rateCount: number;
  pincodeCount: number;
};

export async function listZones(): Promise<ZoneRow[]> {
  const zones = await db.shippingZone.findMany({
    orderBy: [{ position: "asc" }, { name: "asc" }],
    include: { _count: { select: { rates: true, pincodes: true } } },
  });
  return zones.map(({ _count, ...zone }) => ({ ...zone, rateCount: _count.rates, pincodeCount: _count.pincodes }));
}

/** Lightweight options for selects and the CSV importer's zone column. */
export async function listZoneOptions(): Promise<Array<{ id: string; name: string; isDefault: boolean; isActive: boolean }>> {
  return db.shippingZone.findMany({
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true, name: true, isDefault: true, isActive: true },
  });
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

export type RateRow = {
  id: string;
  zoneId: string;
  zoneName: string;
  name: string;
  method: string;
  ratePaise: number;
  freeAbovePaise: number | null;
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
  minOrderPaise: number | null;
  maxOrderPaise: number | null;
  codAvailable: boolean;
  codFeePaise: number;
  estimatedDaysMin: number;
  estimatedDaysMax: number;
  isActive: boolean;
  position: number;
};

export async function listRates(filters: { zoneId?: string } = {}): Promise<RateRow[]> {
  const rates = await db.shippingRate.findMany({
    where: filters.zoneId ? { zoneId: filters.zoneId } : undefined,
    orderBy: [{ zone: { position: "asc" } }, { position: "asc" }, { ratePaise: "asc" }],
    include: { zone: { select: { name: true } } },
  });
  return rates.map(({ zone, ...rate }) => ({ ...rate, zoneName: zone.name }));
}

export async function getRate(id: string): Promise<RateRow | null> {
  const rate = await db.shippingRate.findUnique({ where: { id }, include: { zone: { select: { name: true } } } });
  if (!rate) return null;
  const { zone, ...rest } = rate;
  return { ...rest, zoneName: zone.name };
}

// ---------------------------------------------------------------------------
// Partners
// ---------------------------------------------------------------------------

export type PartnerRow = {
  id: string;
  code: string;
  name: string;
  trackingUrlTemplate: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  isActive: boolean;
  position: number;
  shipmentCount: number;
  returnPickupCount: number;
};

export async function listPartners(): Promise<PartnerRow[]> {
  const partners = await db.shippingPartner.findMany({
    orderBy: [{ position: "asc" }, { name: "asc" }],
    include: { _count: { select: { shipments: true, returnPickups: true } } },
  });
  return partners.map(({ _count, ...partner }) => ({ ...partner, shipmentCount: _count.shipments, returnPickupCount: _count.returnPickups }));
}

// ---------------------------------------------------------------------------
// Pincodes
// ---------------------------------------------------------------------------

export type PincodeRow = {
  pincode: string;
  city: string | null;
  state: string | null;
  zoneId: string | null;
  zoneName: string | null;
  isServiceable: boolean;
  codAvailable: boolean;
  estimatedDays: number | null;
  updatedAt: Date;
};

export type PincodeStats = { total: number; serviceable: number; nonServiceable: number; codEnabled: number };

export type PincodeListResult = { rows: PincodeRow[]; meta: PageMeta };

const SORT_COLUMN: Record<PincodeSort, keyof Prisma.PincodeServiceabilityOrderByWithRelationInput> = {
  pincode: "pincode",
  city: "city",
  state: "state",
  updatedAt: "updatedAt",
};

export function buildPincodeWhere(filters: PincodeListFilters): Prisma.PincodeServiceabilityWhereInput {
  const clauses: Prisma.PincodeServiceabilityWhereInput[] = [];

  if (filters.q) {
    // Digits search the pincode as a prefix (how operators think about PIN
    // ranges); anything else matches the city or state.
    clauses.push(
      /^\d+$/.test(filters.q)
        ? { pincode: { startsWith: filters.q } }
        : { OR: [{ city: { contains: filters.q, mode: "insensitive" } }, { state: { contains: filters.q, mode: "insensitive" } }] },
    );
  }
  if (filters.zoneId === "none") clauses.push({ zoneId: null });
  else if (filters.zoneId) clauses.push({ zoneId: filters.zoneId });
  if (filters.serviceable !== undefined) clauses.push({ isServiceable: filters.serviceable });
  if (filters.cod !== undefined) clauses.push({ codAvailable: filters.cod });

  return clauses.length > 0 ? { AND: clauses } : {};
}

export function pincodeOrderBy(params: Pick<ListParams, "sort" | "order">): Prisma.PincodeServiceabilityOrderByWithRelationInput[] {
  const column = SORT_COLUMN[params.sort as PincodeSort] ?? "pincode";
  // Pincode as the tiebreaker keeps pages stable while rows are being edited (§11.28).
  return column === "pincode" ? [{ pincode: params.order }] : [{ [column]: params.order }, { pincode: "asc" }];
}

export async function listPincodes(params: ListParams, filters: PincodeListFilters): Promise<PincodeListResult> {
  const where = buildPincodeWhere(filters);
  const [total, rows] = await Promise.all([
    db.pincodeServiceability.count({ where }),
    db.pincodeServiceability.findMany({
      where,
      orderBy: pincodeOrderBy(params),
      skip: params.skip,
      take: params.pageSize,
      include: { zone: { select: { name: true } } },
    }),
  ]);
  return {
    rows: rows.map(({ zone, ...row }) => ({ ...row, zoneName: zone?.name ?? null })),
    meta: buildPageMeta(total, params),
  };
}

export async function getPincodeStats(): Promise<PincodeStats> {
  const [total, serviceable, codEnabled] = await Promise.all([
    db.pincodeServiceability.count(),
    db.pincodeServiceability.count({ where: { isServiceable: true } }),
    db.pincodeServiceability.count({ where: { isServiceable: true, codAvailable: true } }),
  ]);
  return { total, serviceable, nonServiceable: total - serviceable, codEnabled };
}
