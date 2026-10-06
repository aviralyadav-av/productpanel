import "dotenv/config";

import { db } from "@/lib/db";
import { InventoryError, applyStockAdjustment, applyStockMovement, getStockSummaryForProduct } from "@/features/inventory/service";

/**
 * End-to-end check against the REAL database (blueprint F7, §11.7, §11.29):
 *
 *   npx tsx src/features/inventory/__checks__/inventory-check.ts
 *
 * Picks a demo variant, adjusts it UP through the service, then DOWN by the
 * same amount, and asserts after each step that the ledger's last row equals
 * the projection (balance == onHand, reservedBalance == reserved), that the
 * sum of every delta ever written equals onHand, and that the two movements
 * net to zero. Then proves the negative guard: a remove that would take
 * available below zero on a no-backorder variant throws INSUFFICIENT_STOCK
 * and leaves the ledger untouched. Cleans up its own rows.
 */

const TAG = "__inventory-check__";
const UNITS = 7;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

async function snapshot(variantId: string) {
  const [item, last, sum, count] = await Promise.all([
    db.inventoryItem.findUnique({ where: { variantId } }),
    db.stockMovement.findFirst({ where: { variantId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    db.stockMovement.aggregate({ where: { variantId }, _sum: { delta: true, reservedDelta: true } }),
    db.stockMovement.count({ where: { variantId } }),
  ]);
  assert(item, "inventory item exists");
  assert(last, "at least one movement exists");
  return { item, last, sumDelta: sum._sum.delta ?? 0, sumReserved: sum._sum.reservedDelta ?? 0, count };
}

async function assertConsistent(variantId: string, label: string) {
  const s = await snapshot(variantId);
  assert(s.last.balance === s.item.onHand, `${label}: last balance ${s.last.balance} == onHand ${s.item.onHand}`);
  assert(s.last.reservedBalance === s.item.reserved, `${label}: last reservedBalance == reserved`);
  assert(s.sumDelta === s.item.onHand, `${label}: Σdelta ${s.sumDelta} == onHand ${s.item.onHand}`);
  assert(s.sumReserved === s.item.reserved, `${label}: ΣreservedDelta == reserved`);
  assert(s.item.available === s.item.onHand - s.item.reserved, `${label}: available == onHand - reserved`);
  return s;
}

async function main(): Promise<void> {
  const variant = await db.productVariant.findFirst({
    where: { id: { startsWith: "demo_" }, deletedAt: null, inventory: { is: { allowBackorder: false } } },
    orderBy: { id: "asc" },
    select: { id: true, name: true, productId: true, product: { select: { title: true } } },
  });
  assert(variant, "a demo variant with an inventory row exists (run the seed)");
  const { id: variantId } = variant;
  console.log(`variant: ${variant.product.title} · ${variant.name} (${variantId})`);

  const before = await assertConsistent(variantId, "before");
  console.log(`before: onHand=${before.item.onHand} reserved=${before.item.reserved} movements=${before.count}`);

  // 1. UP by UNITS through the operator path (mode add).
  const up = await db.$transaction((tx) =>
    applyStockAdjustment(tx, { variantId, mode: "add", quantity: UNITS, type: "PURCHASE", reason: TAG, note: TAG }),
  );
  assert(up.moved && up.delta === UNITS, "add moved +UNITS");
  const afterUp = await assertConsistent(variantId, "after up");
  assert(afterUp.item.onHand === before.item.onHand + UNITS, "onHand rose by UNITS");
  assert(afterUp.count === before.count + 1, "exactly one ledger row written");
  assert(afterUp.last.type === "PURCHASE" && afterUp.last.delta === UNITS, "ledger row is PURCHASE +UNITS");

  // 2. DOWN to the original count via "set" - the delta must be derived under the lock.
  const down = await db.$transaction((tx) =>
    applyStockAdjustment(tx, { variantId, mode: "set", quantity: before.item.onHand, type: "CORRECTION", reason: TAG, note: TAG }),
  );
  assert(down.moved && down.delta === -UNITS, `set derived delta -UNITS (got ${down.delta})`);
  const afterDown = await assertConsistent(variantId, "after down");
  assert(afterDown.item.onHand === before.item.onHand, "net zero: onHand back to the original");
  assert(afterDown.item.stockState === before.item.stockState, "stockState restored");
  assert(up.delta + down.delta === 0, "the two movements net to zero");

  // 3. A zero-delta set writes nothing.
  const noop = await db.$transaction((tx) =>
    applyStockAdjustment(tx, { variantId, mode: "set", quantity: before.item.onHand, type: "CORRECTION", reason: TAG }),
  );
  assert(!noop.moved && noop.change === null, "set to the current count writes no movement");
  assert((await snapshot(variantId)).count === before.count + 2, "ledger count unchanged by the no-op");

  // 4. Negative guard: removing more than available on a no-backorder variant is refused, atomically.
  let refused = false;
  try {
    await db.$transaction((tx) =>
      applyStockMovement(tx, { variantId, delta: -(afterDown.item.available + 1), type: "DAMAGE", reason: TAG }),
    );
  } catch (error) {
    refused = error instanceof InventoryError && error.code === "INSUFFICIENT_STOCK";
  }
  assert(refused, "over-removal throws INSUFFICIENT_STOCK");
  const afterRefusal = await assertConsistent(variantId, "after refusal");
  assert(afterRefusal.count === before.count + 2, "refused movement left no ledger row");

  // 5. Product summary agrees with the projection.
  const summary = await getStockSummaryForProduct(variant.productId);
  const row = summary.variants.find((v) => v.variantId === variantId);
  assert(row && row.onHand === afterRefusal.item.onHand, "product summary reads the same onHand");

  // Cleanup: remove only our two ledger rows. The projection is already back
  // where it started, so the ledger replays to the same figure without them.
  const deleted = await db.stockMovement.deleteMany({ where: { variantId, note: TAG } });
  assert(deleted.count === 2, `cleaned up 2 check rows (got ${deleted.count})`);
  await assertConsistent(variantId, "after cleanup");

  console.log("inventory-check: OK (ledger == projection, net zero, negative blocked)");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
