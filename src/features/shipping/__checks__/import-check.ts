import { SYSTEM_ACTOR } from "@/lib/audit";
import { db } from "@/lib/db";

import { importPincodes } from "@/features/shipping/pincode-import";
import { checkPincode } from "@/features/shipping/service";

/**
 * Round-trips the CSV importer against the REAL database and cleans up:
 *
 *   node --env-file=.env --import tsx src/features/shipping/__checks__/import-check.ts
 *
 * Uses pincodes in the 99xxxx range that no Indian PIN plan assigns, so it
 * cannot collide with imported data.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`);
}

const PINS = ["990001", "990002", "990003"];

async function main() {
  await db.pincodeServiceability.deleteMany({ where: { pincode: { in: PINS } } });
  const defaultZone = await db.shippingZone.findFirst({ where: { isDefault: true }, select: { id: true, name: true } });
  assert(defaultZone, "a default zone exists");

  const first = ["pincode,city,state,zone,serviceable,cod,estimatedDays", `990001,Testville,Delhi,${defaultZone.name},yes,no,4`, "990002,Otherton,Orissa,,no,yes,", "990003,,,,,,", "12345,bad,,,,,", "990001,Testville Again,,,,,"].join("\n");

  const dry = await importPincodes({ csv: first, dryRun: true, actor: SYSTEM_ACTOR });
  console.log("dry run", dry);
  assert(dry.validRows === 3 && dry.invalidRows === 1 && dry.duplicates === 1 && dry.toCreate === 3 && dry.created === 0, "dry run counts");
  assert((await db.pincodeServiceability.count({ where: { pincode: { in: PINS } } })) === 0, "dry run wrote nothing");

  const applied = await importPincodes({ csv: first, dryRun: false, actor: SYSTEM_ACTOR });
  console.log("applied", applied);
  assert(applied.created === 3 && applied.updated === 0, "three rows created");

  const row1 = await db.pincodeServiceability.findUnique({ where: { pincode: "990001" } });
  assert(row1?.city === "Testville Again" && row1.state === "Delhi" && row1.zoneId === defaultZone.id && row1.codAvailable === false && row1.estimatedDays === 4, "last duplicate wins, zone by name, state canonical");
  const row2 = await db.pincodeServiceability.findUnique({ where: { pincode: "990002" } });
  assert(row2?.state === "Odisha" && row2.isServiceable === false, "Orissa canonicalised to Odisha; serviceable off");

  const check2 = await checkPincode("990002");
  assert(check2.known && !check2.serviceable, "checkPincode honours a non-serviceable row");

  // Second file: only pincode + cod; city/state/zone must survive.
  const second = ["pincode,cod", "990001,yes", "990002,no"].join("\n");
  const updated = await importPincodes({ csv: second, dryRun: false, actor: SYSTEM_ACTOR });
  assert(updated.created === 0 && updated.updated === 2, "two rows updated");
  const row1b = await db.pincodeServiceability.findUnique({ where: { pincode: "990001" } });
  assert(row1b?.city === "Testville Again" && row1b.zoneId === defaultZone.id && row1b.codAvailable === true, "blank columns left existing values alone");

  await db.pincodeServiceability.deleteMany({ where: { pincode: { in: PINS } } });
  console.log("import-check: OK");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
