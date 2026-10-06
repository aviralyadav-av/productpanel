import "dotenv/config";

import { db } from "@/lib/db";
import { resolveRange } from "@/lib/dates";

import {
  buildLedgerWhere,
  buildPayoutWhere,
  getPayoutFilterRefs,
  listLedgerEntries,
  listPayouts,
  listSellerBalances,
  listSellerBankAccounts,
  pageLedgerForExport,
  pagePayoutsForExport,
  payoutKpis,
  payoutStatusCounts,
} from "@/features/finance/payout-queries";
import { getStatementIdentity } from "@/features/finance/payout-detail-queries";
import {
  commissionScopeCounts,
  commissionSummary,
  getGlobalCommissionRule,
  getMarketplaceCharges,
  listCommissionRules,
  resolveCommissionForProduct,
} from "@/features/finance/queries";
import { LEDGER_ENTRY_STATUSES, LEDGER_ENTRY_TYPES } from "@/lib/enums";

/**
 * Read-side smoke check against the REAL database. The query modules are
 * `server-only`, so this needs the stub:
 *
 *   node --env-file=.env --import tsx \
 *     --import ./src/features/storefront/__checks__/stub-server-only.ts \
 *     src/features/finance/__checks__/finance-read-check.ts
 *
 * It writes nothing. Its job is to prove every query the two screens call
 * actually executes against Postgres - the sort columns, the grouped counts
 * and the export pagers included - because a bad `orderBy` only fails at
 * runtime and a list page that throws is indistinguishable from an empty one.
 */

let passed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
  passed += 1;
}

const LIST = { page: 1, pageSize: 10, q: "", order: "desc" as const, skip: 0 };

async function main(): Promise<void> {
  console.log("FINANCE READ CHECK\n");
  const range = resolveRange("30d");

  // ---- Commissions -------------------------------------------------------
  const globalRule = await getGlobalCommissionRule();
  console.log(`  Global rule: ${globalRule ? `${globalRule.rateBps} bps` : "MISSING (falls back to 0%)"}`);

  for (const sort of ["scope", "rateBps", "fixedPaise", "updatedAt", "createdAt"] as const) {
    const result = await listCommissionRules({ ...LIST, sort }, { q: "" });
    assert(Array.isArray(result.rows), `listCommissionRules sorts by ${sort}`);
  }
  console.log("  Commission rules: all five sorts execute");

  const scopeCounts = await commissionScopeCounts({ q: "" });
  assert(
    scopeCounts.all === scopeCounts.GLOBAL + scopeCounts.CATEGORY + scopeCounts.SELLER + scopeCounts.PRODUCT,
    "scope counts add up to the total",
  );
  const filteredCounts = await commissionScopeCounts({ q: "", scope: "SELLER" });
  assert(
    filteredCounts.all === scopeCounts.all,
    "the scope filter is dropped from its own counts, so a tab never reads zero while holding rows",
  );
  console.log(`  Scope counts: ${scopeCounts.all} rules (${scopeCounts.SELLER} seller, ${scopeCounts.CATEGORY} category)`);

  const charges = await getMarketplaceCharges();
  assert(Array.isArray(charges), "marketplace.charges parses into editable rows");
  console.log(`  Marketplace charges: ${charges.length} rule(s)`);

  const summary = await commissionSummary(range);
  assert(summary.sellers.every((row) => row.grossPaise >= 0), "seller gross is never negative");
  assert(
    summary.commissionPaise === summary.sellers.reduce((sum, row) => sum + row.commissionPaise, 0) ||
      summary.sellers.length === 12,
    "the totals are the sum of the rows (unless the list was capped)",
  );
  console.log(
    `  Commission summary (${range.label}): ${summary.lines} lines · commission ₹${summary.commissionPaise / 100} · payable ₹${summary.payablePaise / 100}`,
  );

  const product = await db.product.findFirst({
    where: { deletedAt: null, sellerId: { not: null } },
    select: { id: true, title: true },
  });
  if (product) {
    const resolution = await resolveCommissionForProduct(product.id);
    assert(resolution !== null, "a live product resolves");
    assert(resolution!.chain.length >= 2, "the chain has at least the product step and GLOBAL");
    assert(
      resolution!.chain[resolution!.chain.length - 1].scope === "GLOBAL",
      "GLOBAL is always the last step in the chain",
    );
    const applied = resolution!.chain.filter((step) => step.applied);
    assert(applied.length <= 1, "at most one step is marked as applied");
    console.log(
      `  Resolution for "${product.title}": ${resolution!.resolved.rateBps} bps via ${resolution!.resolved.scope} · ${resolution!.chain.length} steps`,
    );
  } else {
    console.log("  Resolution: skipped (no seller-owned product in the database)");
  }

  // ---- Payouts -----------------------------------------------------------
  const kpis = await payoutKpis();
  assert(kpis.minPayoutPaise >= 0, "the minimum payout setting reads back");
  console.log(
    `  KPIs: pending ₹${kpis.pendingPaise / 100} · available ₹${kpis.availablePaise / 100} · scheduled ₹${kpis.scheduledPaise / 100} · held sellers ${kpis.heldSellers}`,
  );

  for (const sort of ["seller", "pending", "available", "scheduled", "paid"] as const) {
    const result = await listSellerBalances({ ...LIST, sort }, { q: "", onlyOwed: false });
    assert(Array.isArray(result.rows), `listSellerBalances sorts by ${sort}`);
  }
  const balances = await listSellerBalances({ ...LIST, sort: "available" }, { q: "", onlyOwed: true });
  assert(
    balances.rows.every(
      (row) => row.pendingPaise > 0 || row.availablePaise > 0 || row.scheduledPaise > 0,
    ),
    "owed=1 hides sellers with nothing in flight",
  );
  console.log(`  Balances: all five sorts execute · ${balances.meta.total} seller(s) owed something`);

  if (balances.rows[0]) {
    const accounts = await listSellerBankAccounts(balances.rows[0].sellerId);
    assert(
      accounts.every((account) => account.last4.length <= 4),
      "bank accounts expose only the last four digits (D4)",
    );
    const refs = await getPayoutFilterRefs({ sellerId: balances.rows[0].sellerId });
    assert(refs.seller?.id === balances.rows[0].sellerId, "the ?seller= chip hydrates");
  }

  for (const sort of ["createdAt", "payoutNumber", "seller", "netPaise", "periodTo", "paidAt"] as const) {
    const result = await listPayouts({ ...LIST, sort }, { q: "" });
    assert(Array.isArray(result.rows), `listPayouts sorts by ${sort}`);
  }
  const statusCounts = await payoutStatusCounts({ q: "" });
  console.log(`  Statements: all six sorts execute · ${statusCounts.all} statement(s)`);

  const ledger = await listLedgerEntries({ ...LIST, sort: "createdAt", pageSize: 25 }, { q: "" });
  assert(
    ledger.totals.netPaise === ledger.totals.creditPaise - ledger.totals.debitPaise,
    "ledger totals reconcile (net = credits − debits)",
  );
  console.log(
    `  Ledger: ${ledger.meta.total} entries · credits ₹${ledger.totals.creditPaise / 100} · debits ₹${ledger.totals.debitPaise / 100}`,
  );

  // Every filter dimension the toolbar offers must produce valid SQL.
  for (const type of LEDGER_ENTRY_TYPES) {
    const result = await listLedgerEntries({ ...LIST, sort: "createdAt" }, { q: "", type });
    assert(
      result.rows.every((row) => row.type === type),
      `the ${type} filter returns only ${type} rows`,
    );
  }
  for (const status of LEDGER_ENTRY_STATUSES) {
    const result = await listLedgerEntries({ ...LIST, sort: "createdAt" }, { q: "", status });
    assert(
      result.rows.every((row) => row.status === status),
      `the ${status} filter returns only ${status} rows`,
    );
  }
  console.log("  Ledger filters: every type and status executes and narrows correctly");

  assert(
    Object.keys(buildLedgerWhere({ q: "x", sellerId: "s", type: "SALE", status: "PAID" }, range)).length > 0,
    "buildLedgerWhere composes every dimension",
  );
  assert(
    Object.keys(buildPayoutWhere({ q: "x", status: "PAID", sellerId: "s" }, range)).length > 0,
    "buildPayoutWhere composes every dimension",
  );

  const exportPayoutPage = await pagePayoutsForExport({ q: "" }, undefined, 0, 5);
  const exportLedgerPage = await pageLedgerForExport({ q: "" }, undefined, 0, 5);
  assert(Array.isArray(exportPayoutPage), "the statements export pager executes");
  assert(Array.isArray(exportLedgerPage), "the ledger export pager executes");
  console.log("  Export pagers execute");

  const identity = await getStatementIdentity();
  assert(identity.name.length > 0, "the print header has a store name");
  console.log(`  Print header: ${identity.name}`);

  console.log(`\nPASSED · ${passed} assertions`);
}

main()
  .catch((error) => {
    console.error("\nFAILED", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
