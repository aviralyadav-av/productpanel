/**
 * Read-side check for RETURNS, REFUNDS and PAYMENTS:
 *
 *   node --env-file=.env --import tsx --import ./src/features/storefront/__checks__/stub-server-only.ts \n *     src/features/returns/__checks__/read-check.ts
 *
 * Every list, KPI, detail, cap and export page in the three modules is run
 * against the real database. It writes nothing; it exists because the read
 * side carries raw SQL (the webhook lookup) and several hand-written filters
 * that a type-check cannot exercise.
 */
import { db } from "@/lib/db";
import { listReturns, returnKpis, returnStatusCounts, getReturnDetail, getReturnRefundCap, listReturnActivity, listPickupPartners, getReturnPolicySettings, pageReturnsForExport } from "@/features/returns/queries";
import { listRefunds, refundKpis, refundStatusCounts, getRefundDetail, getRefundOrderOption, pageRefundsForExport } from "@/features/refunds/queries";
import { listPayments, paymentKpis, getPaymentDetail, pagePaymentsForExport, listWebhookEventsFor } from "@/features/payments/queries";

const params = { q: "", page: 1, pageSize: 25, skip: 0, order: "desc" as const };

async function main() {
  const r = await listReturns({ ...params, sort: "requested" }, { state: "open" });
  console.log("returns", r.total, r.rows[0]?.rmaNumber);
  console.log("return kpis", await returnKpis());
  console.log("return counts", (await returnStatusCounts({}, "")).all);
  console.log("policy", await getReturnPolicySettings());
  console.log("partners", (await listPickupPartners()).length);
  const anyRma = await db.returnRequest.findFirst({ select: { id: true } });
  if (anyRma) {
    const detail = await getReturnDetail(anyRma.id);
    console.log("return detail", detail?.rmaNumber, detail?.item.title, detail?.events.length);
    console.log("cap", await getReturnRefundCap(detail!.id, detail!.order.id));
    console.log("activity", (await listReturnActivity(detail!.id, detail!.refund?.id ?? null)).length);
  }
  console.log("export rows", (await pageReturnsForExport({}, "", 0, 5)).length);

  const f = await listRefunds({ ...params, sort: "created" }, {});
  console.log("refunds", f.total, f.rows[0]?.refundNumber);
  console.log("refund kpis", await refundKpis());
  console.log("refund counts", (await refundStatusCounts({}, "")).all);
  if (f.rows[0]) {
    const d = await getRefundDetail(f.rows[0].id);
    console.log("refund detail", d?.refundNumber, d?.refundableRemainingPaise, d?.settlementPayments.length, d?.returnRequest?.rmaNumber);
    console.log("order option", await getRefundOrderOption(d!.orderNumber));
  }
  console.log("refund export", (await pageRefundsForExport({}, "", 0, 5)).length);

  const p = await listPayments({ ...params, sort: "created" }, {});
  console.log("payments", p.total, p.rows[0]?.provider, p.rows[0]?.type);
  console.log("payment kpis", await paymentKpis());
  if (p.rows[0]) {
    const d = await getPaymentDetail(p.rows[0].id, { includeRaw: true });
    console.log("payment detail", d?.provider, d?.refunds.length, d?.relatedRefundPayments.length, d?.webhookEvents.length);
  }
  console.log("webhook raw", (await listWebhookEventsFor("RAZORPAY", ["order_test123456"])).length);
  console.log("payment export", (await pagePaymentsForExport({}, "", 0, 5)).length);
  console.log("\nREAD SMOKE OK");
}
main().catch((e) => { console.error("FAILED", e); process.exitCode = 1; }).finally(() => db.$disconnect());
