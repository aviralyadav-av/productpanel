import type { Prisma } from "@prisma/client";

import { writeAudit, type AuditActor } from "@/lib/audit";
import { db } from "@/lib/db";

import {
  PINCODE_IMPORT_BATCH_SIZE,
  parsePincodeCsv,
  validatePincodeRows,
  type NormalizedPincodeRow,
  type PincodeRowError,
} from "@/features/shipping/csv";

/**
 * CSV import of pincode serviceability (blueprint §1 Shipping, §11.28, D13).
 *
 * Two passes with the same code path: `dryRun` stops after validation and
 * returns the report the dialog shows; the real run applies rows in batches
 * of 1,000 - `createMany` with `skipDuplicates` for new pincodes and
 * individual updates for known ones - each batch in its own transaction so a
 * 50k-row file never holds one long transaction open. The audit row records
 * counts, not rows.
 *
 * "Blank means unchanged": a validated row only carries the columns the file
 * had values for, so a courier's serviceability-only file cannot erase the
 * city, state or zone typed in by hand.
 */

export type PincodeImportReport = {
  dryRun: boolean;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicates: number;
  toCreate: number;
  toUpdate: number;
  created: number;
  updated: number;
  /** File-level problems (bad header, too many rows). */
  fileErrors: string[];
  /** Row-level problems, capped for the UI; `invalidRows` has the full count. */
  errors: PincodeRowError[];
  /** Zones the file referenced by name/id and we recognised. */
  zonesUsed: string[];
};

export const MAX_REPORTED_ERRORS = 100;

const EXISTS_CHUNK = 5_000;

function toCreateData(row: NormalizedPincodeRow): Prisma.PincodeServiceabilityCreateManyInput {
  return {
    pincode: row.pincode,
    city: row.city ?? null,
    state: row.state ?? null,
    zoneId: row.zoneId ?? null,
    isServiceable: row.isServiceable ?? true,
    codAvailable: row.codAvailable ?? true,
    estimatedDays: row.estimatedDays ?? null,
  };
}

function toUpdateData(row: NormalizedPincodeRow): Prisma.PincodeServiceabilityUpdateInput {
  const data: Prisma.PincodeServiceabilityUpdateInput = {};
  if (row.city !== undefined) data.city = row.city;
  if (row.state !== undefined) data.state = row.state;
  if (row.zoneId !== undefined) data.zone = row.zoneId ? { connect: { id: row.zoneId } } : { disconnect: true };
  if (row.isServiceable !== undefined) data.isServiceable = row.isServiceable;
  if (row.codAvailable !== undefined) data.codAvailable = row.codAvailable;
  if (row.estimatedDays !== undefined) data.estimatedDays = row.estimatedDays;
  return data;
}

async function existingPincodes(pincodes: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let index = 0; index < pincodes.length; index += EXISTS_CHUNK) {
    const chunk = pincodes.slice(index, index + EXISTS_CHUNK);
    const rows = await db.pincodeServiceability.findMany({ where: { pincode: { in: chunk } }, select: { pincode: true } });
    for (const row of rows) found.add(row.pincode);
  }
  return found;
}

export async function importPincodes(input: {
  csv: string;
  dryRun: boolean;
  actor: AuditActor;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<PincodeImportReport> {
  const parsed = parsePincodeCsv(input.csv);
  const zones = await db.shippingZone.findMany({ select: { id: true, name: true }, orderBy: { position: "asc" } });
  const validation = validatePincodeRows(parsed.rows, zones);

  const zoneNames = new Map(zones.map((zone) => [zone.id, zone.name]));
  const zonesUsed = [...new Set(validation.rows.map((row) => row.zoneId).filter((id): id is string => !!id))]
    .map((id) => zoneNames.get(id) ?? id)
    .sort();

  const existing = validation.rows.length > 0 ? await existingPincodes(validation.rows.map((row) => row.pincode)) : new Set<string>();
  const toUpdate = validation.rows.filter((row) => existing.has(row.pincode)).length;

  const report: PincodeImportReport = {
    dryRun: input.dryRun,
    totalRows: parsed.rows.length,
    validRows: validation.rows.length,
    invalidRows: validation.errors.length,
    duplicates: validation.duplicates,
    toCreate: validation.rows.length - toUpdate,
    toUpdate,
    created: 0,
    updated: 0,
    fileErrors: parsed.errors,
    errors: validation.errors.slice(0, MAX_REPORTED_ERRORS),
    zonesUsed,
  };

  if (input.dryRun || parsed.errors.length > 0 || validation.rows.length === 0) return report;

  for (let index = 0; index < validation.rows.length; index += PINCODE_IMPORT_BATCH_SIZE) {
    const batch = validation.rows.slice(index, index + PINCODE_IMPORT_BATCH_SIZE);
    const counts = await db.$transaction(
      async (tx) => {
        // Re-check inside the transaction: another import may have landed since the dry run.
        const known = new Set(
          (await tx.pincodeServiceability.findMany({ where: { pincode: { in: batch.map((row) => row.pincode) } }, select: { pincode: true } })).map((row) => row.pincode),
        );
        const creates = batch.filter((row) => !known.has(row.pincode));
        const updates = batch.filter((row) => known.has(row.pincode));

        const created = creates.length > 0 ? (await tx.pincodeServiceability.createMany({ data: creates.map(toCreateData), skipDuplicates: true })).count : 0;

        let updated = 0;
        for (let offset = 0; offset < updates.length; offset += 50) {
          const slice = updates.slice(offset, offset + 50);
          await Promise.all(slice.map((row) => tx.pincodeServiceability.update({ where: { pincode: row.pincode }, data: toUpdateData(row) })));
          updated += slice.length;
        }
        return { created, updated };
      },
      { timeout: 120_000, maxWait: 15_000 },
    );
    report.created += counts.created;
    report.updated += counts.updated;
  }

  await writeAudit({
    actor: input.actor,
    action: "pincode.import",
    entityType: "PincodeServiceability",
    summary: `Imported pincodes from CSV: ${report.created} created, ${report.updated} updated, ${report.invalidRows} rejected.`,
    diff: {
      totalRows: report.totalRows,
      created: report.created,
      updated: report.updated,
      invalidRows: report.invalidRows,
      duplicates: report.duplicates,
      zonesUsed: report.zonesUsed,
    },
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return report;
}
