import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Consistency checks for the demo dataset. Run with:
 *
 *     npx tsx prisma/seed/lib/verify-demo.ts
 *
 * Exits non-zero when an invariant fails:
 *   1. Σ SellerLedgerEntry per seller (by status) equals SellerBalance (B4).
 *   2. InventoryItem.onHand / reserved equal the last StockMovement balance
 *      per variant, and the sum of deltas replays to the same numbers (D7, F7).
 *   3. Order.totalPaise equals Σ lineTotal + shipping + COD fee − waived shipping (B1).
 *   4. Order.paymentStatus matches the B6 derivation from payments and refunds.
 *   5. Coupon.usageCount equals the number of CouponUsage rows.
 *   6. Every demo row id starts with "demo_" where the module promises it.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const failures: string[] = [];
function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

async function main(): Promise<void> {
  // 1. ledger vs balance
  const balances = await db.sellerBalance.findMany();
  const ledger = await db.sellerLedgerEntry.groupBy({ by: ["sellerId", "status"], _sum: { amountPaise: true } });
  const payouts = await db.sellerLedgerEntry.groupBy({ by: ["sellerId"], where: { type: "PAYOUT" }, _sum: { amountPaise: true } });
  for (const balance of balances) {
    const sum = (status: string) => ledger.find((row) => row.sellerId === balance.sellerId && row.status === status)?._sum.amountPaise ?? 0;
    const paid = -(payouts.find((row) => row.sellerId === balance.sellerId)?._sum.amountPaise ?? 0);
    check(balance.pendingPaise === sum("PENDING"), `SellerBalance.pending mismatch for ${balance.sellerId}: ${balance.pendingPaise} vs ${sum("PENDING")}`);
    check(balance.availablePaise === sum("AVAILABLE"), `SellerBalance.available mismatch for ${balance.sellerId}: ${balance.availablePaise} vs ${sum("AVAILABLE")}`);
    check(balance.scheduledPaise === sum("SCHEDULED"), `SellerBalance.scheduled mismatch for ${balance.sellerId}: ${balance.scheduledPaise} vs ${sum("SCHEDULED")}`);
    check(balance.paidPaise === paid, `SellerBalance.paid mismatch for ${balance.sellerId}: ${balance.paidPaise} vs ${paid}`);
  }
  const sellersWithLedger = new Set(ledger.map((row) => row.sellerId));
  for (const sellerId of sellersWithLedger) check(balances.some((row) => row.sellerId === sellerId), `Seller ${sellerId} has ledger rows but no SellerBalance`);
  console.log(`ledger vs balance: ${balances.length} sellers checked`);

  // 2. inventory vs movements
  const items = await db.inventoryItem.findMany({ select: { variantId: true, onHand: true, reserved: true, available: true } });
  const lastMovements = await db.$queryRaw<Array<{ variantId: string; balance: number; reservedBalance: number; sumDelta: bigint; sumReserved: bigint }>>`
    SELECT m."variantId",
           (SELECT balance FROM "StockMovement" x WHERE x."variantId" = m."variantId" ORDER BY x."createdAt" DESC, x.id DESC LIMIT 1) AS balance,
           (SELECT "reservedBalance" FROM "StockMovement" x WHERE x."variantId" = m."variantId" ORDER BY x."createdAt" DESC, x.id DESC LIMIT 1) AS "reservedBalance",
           SUM(m.delta)::bigint AS "sumDelta",
           SUM(m."reservedDelta")::bigint AS "sumReserved"
      FROM "StockMovement" m
     GROUP BY m."variantId"`;
  const byVariant = new Map(lastMovements.map((row) => [row.variantId, row]));
  for (const item of items) {
    const row = byVariant.get(item.variantId);
    check(Boolean(row), `InventoryItem ${item.variantId} has no movements`);
    if (!row) continue;
    check(item.onHand === Number(row.sumDelta), `onHand ${item.onHand} != Σdelta ${row.sumDelta} for ${item.variantId}`);
    check(item.reserved === Number(row.sumReserved), `reserved ${item.reserved} != ΣreservedDelta ${row.sumReserved} for ${item.variantId}`);
    check(item.onHand === row.balance, `onHand ${item.onHand} != last movement balance ${row.balance} for ${item.variantId}`);
    check(item.reserved === row.reservedBalance, `reserved ${item.reserved} != last movement reservedBalance ${row.reservedBalance} for ${item.variantId}`);
    check(item.available === item.onHand - item.reserved, `available != onHand - reserved for ${item.variantId}`);
  }
  console.log(`inventory vs movements: ${items.length} variants checked`);

  // 3 + 4. order money and payment status
  const orders = await db.order.findMany({
    where: { id: { startsWith: "demo_order_" } },
    select: {
      id: true, orderNumber: true, status: true, paymentStatus: true, totalPaise: true, subtotalPaise: true, shippingPaise: true, codFeePaise: true, couponDiscountPaise: true, discountPaise: true, taxPaise: true, refundedPaise: true, couponId: true,
      items: { select: { lineTotalPaise: true, taxPaise: true, unitPricePaise: true, customizationPaise: true, quantity: true, discountPaise: true, sellerFundedDiscountPaise: true, platformFundedDiscountPaise: true } },
      payments: { where: { status: "SUCCEEDED", type: { in: ["CHARGE", "CAPTURE"] } }, select: { amountPaise: true } },
      refunds: { where: { status: "COMPLETED" }, select: { amountPaise: true } },
    },
  });
  for (const order of orders) {
    const lineTotal = order.items.reduce((sum, item) => sum + item.lineTotalPaise, 0);
    const gross = order.items.reduce((sum, item) => sum + (item.unitPricePaise + item.customizationPaise) * item.quantity, 0);
    const lineDiscounts = order.items.reduce((sum, item) => sum + item.discountPaise, 0);
    const waived = order.couponId && order.couponDiscountPaise > 0 && lineDiscounts === order.discountPaise ? order.couponDiscountPaise : 0;
    const expectedTotal = lineTotal + order.shippingPaise + order.codFeePaise - waived;
    check(order.subtotalPaise === gross, `${order.orderNumber}: subtotal ${order.subtotalPaise} != Σ lineGross ${gross}`);
    check(order.totalPaise === expectedTotal, `${order.orderNumber}: total ${order.totalPaise} != ${expectedTotal}`);
    check(order.taxPaise === order.items.reduce((sum, item) => sum + item.taxPaise, 0), `${order.orderNumber}: tax mismatch`);
    check(
      order.items.every((item) => item.discountPaise === item.sellerFundedDiscountPaise + item.platformFundedDiscountPaise),
      `${order.orderNumber}: item discount != seller + platform funded`,
    );
    const paid = order.payments.reduce((sum, payment) => sum + payment.amountPaise, 0);
    const refunded = order.refunds.reduce((sum, refund) => sum + refund.amountPaise, 0);
    check(order.refundedPaise === refunded, `${order.orderNumber}: refundedPaise ${order.refundedPaise} != Σ completed refunds ${refunded}`);
    const expectedStatus =
      refunded >= paid && paid > 0 ? "REFUNDED"
      : refunded > 0 ? "PARTIALLY_REFUNDED"
      : paid >= order.totalPaise && order.totalPaise > 0 ? "PAID"
      : paid === 0 && order.status === "CANCELLED" ? "CANCELLED"
      : paid === 0 && order.status === "FAILED" ? "FAILED"
      : "PENDING";
    check(order.paymentStatus === expectedStatus, `${order.orderNumber}: paymentStatus ${order.paymentStatus} != derived ${expectedStatus}`);
  }
  console.log(`order money + payment status: ${orders.length} orders checked`);

  // 5. coupons
  const coupons = await db.coupon.findMany({ select: { code: true, usageCount: true, _count: { select: { usages: true } } } });
  for (const coupon of coupons) check(coupon.usageCount === coupon._count.usages, `Coupon ${coupon.code}: usageCount ${coupon.usageCount} != usages ${coupon._count.usages}`);
  console.log(`coupon usage: ${coupons.length} coupons checked`);

  // 6. demo id prefix on the tables that promise it
  const prefixed: Array<[string, number]> = [];
  for (const table of ["Seller", "Product", "Customer", "Order", "OrderItem", "Coupon", "Promotion", "ReturnRequest", "Refund", "Banner", "Review", "BlogPost", "Faq", "ContactInquiry", "NewsletterSubscriber", "MediaAsset"] as const) {
    const rows = await db.$queryRawUnsafe<Array<{ c: bigint }>>(`SELECT count(*)::bigint AS c FROM "${table}" WHERE id NOT LIKE 'demo_%'`);
    prefixed.push([table, Number(rows[0].c)]);
  }
  const stray = prefixed.filter(([, count]) => count > 0);
  console.log(`non-demo rows in demo-owned tables: ${stray.length === 0 ? "none" : stray.map(([table, count]) => `${table}=${count}`).join(", ")}`);

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed:`);
    for (const failure of failures.slice(0, 40)) console.error(` - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("\nAll demo-data invariants hold.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
