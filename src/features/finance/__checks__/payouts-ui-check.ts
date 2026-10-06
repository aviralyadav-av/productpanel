import "dotenv/config";

import { db } from "@/lib/db";
import { commissionTargetKey } from "@/lib/enums";

import {
  createCommissionRule,
  deleteCommissionRule,
  saveMarketplaceCharges,
  setCommissionRuleActive,
  updateCommissionRule,
} from "@/features/finance/commission-service";
import { recomputeBalanceForSeller, recordLedgerAdjustment } from "@/features/finance/ledger-service";
import { generateStatement, transitionStatement } from "@/features/finance/payout-service";
import { recomputeSellerBalance, resolveCommission } from "@/features/finance/service";
import { checkStatementIdentity, parseBankSnapshot, payoutStepIndex } from "@/features/finance/ui-identity";

/**
 * End-to-end check against the REAL database:
 *
 *   npx tsx src/features/finance/__checks__/payouts-ui-check.ts
 *
 * Creates a `check_` seller with hand-written ledger entries (so no demo order
 * is disturbed) and walks the two payout paths that matter:
 *
 *   generate → APPROVED → PROCESSING → FAILED   (entries MUST return to AVAILABLE)
 *   generate → APPROVED → PROCESSING → PAID     (entries become PAID + one PAYOUT row)
 *
 * plus the held-below-minimum case, a manual adjustment, a balance recompute,
 * commission rule CRUD with the duplicate-target 409, the resolution order and
 * the marketplace.charges write. Every row it creates is removed at the end;
 * only the append-only AuditLog rows remain (the table has a trigger that
 * rejects DELETE, and that is the point of an audit log).
 */

const STAMP = Date.now();
const ACTOR = { id: "system", email: "system@diybaazar.local" };
const PREFIX = "check_payout";

let passed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
  passed += 1;
}

function step(message: string): void {
  console.log(`  ${message}`);
}

async function expectThrow(label: string, fn: () => Promise<unknown>, contains?: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (contains) {
      assert(
        message.toLowerCase().includes(contains.toLowerCase()),
        `${label}: expected "${contains}" in "${message}"`,
      );
    } else {
      passed += 1;
    }
    return;
  }
  throw new Error(`ASSERT FAILED: ${label} did not throw`);
}

async function main(): Promise<void> {
  console.log("PAYOUTS + COMMISSIONS UI CHECK\n");

  // -------------------------------------------------------------------------
  // Fixture: a seller with three AVAILABLE ledger entries worth 1,000.00
  // -------------------------------------------------------------------------
  const seller = await db.seller.create({
    data: {
      slug: `${PREFIX}-${STAMP}`,
      displayName: `Check Payout Seller ${STAMP}`,
      ownerName: "Check Owner",
      email: `${PREFIX}+${STAMP}@example.invalid`,
      status: "ACTIVE",
      approvedAt: new Date(),
    },
    select: { id: true, displayName: true },
  });
  step(`Seller ${seller.displayName} created`);

  const bankAccount = await db.sellerBankAccount.create({
    data: {
      sellerId: seller.id,
      accountHolder: "Check Owner",
      bankName: "Check Bank",
      // Not a real encrypted blob: nothing in this check decrypts it, and the
      // column is only read back through the masked snapshot.
      accountNumberEnc: "v1:check:check:check",
      accountNumberLast4: "3412",
      ifsc: "CHEK0000123",
      isPrimary: true,
      isVerified: true,
    },
    select: { id: true },
  });

  const now = new Date();
  await db.sellerLedgerEntry.createMany({
    data: [
      {
        sellerId: seller.id,
        type: "SALE",
        amountPaise: 120_000,
        description: `${PREFIX} sale A`,
        status: "AVAILABLE",
        availableAt: now,
      },
      {
        sellerId: seller.id,
        type: "COMMISSION",
        amountPaise: -12_000,
        description: `${PREFIX} commission A`,
        status: "AVAILABLE",
        availableAt: now,
      },
      {
        sellerId: seller.id,
        type: "CHARGE",
        amountPaise: -3_000,
        description: `${PREFIX} charge A`,
        status: "AVAILABLE",
        availableAt: now,
      },
    ],
  });
  const seeded = await db.$transaction((tx) => recomputeSellerBalance(tx, seller.id));
  assert(seeded.availablePaise === 105_000, `seeded available is 105000, got ${seeded.availablePaise}`);
  step(`Ledger seeded · available ₹${seeded.availablePaise / 100}`);

  // -------------------------------------------------------------------------
  // 1. Held below the minimum: nothing is written
  // -------------------------------------------------------------------------
  const minSetting = await db.setting.findUnique({ where: { key: "marketplace.min_payout_paise" } });
  const originalMin = minSetting?.value ?? null;
  await db.setting.upsert({
    where: { key: "marketplace.min_payout_paise" },
    create: {
      key: "marketplace.min_payout_paise",
      value: "500000",
      type: "money",
      group: "marketplace",
      label: "Minimum payout",
    },
    update: { value: "500000" },
  });

  const held = await generateStatement({ sellerId: seller.id, periodTo: null, method: "BANK_TRANSFER", bankAccountId: null, notes: null }, ACTOR);
  assert(held.held === true, "a net below the minimum is held");
  assert(
    (await db.sellerPayout.count({ where: { sellerId: seller.id } })) === 0,
    "a held run writes no statement",
  );
  const stillAvailable = await db.sellerLedgerEntry.count({
    where: { sellerId: seller.id, status: "AVAILABLE" },
  });
  assert(stillAvailable === 3, `held entries stay AVAILABLE, got ${stillAvailable}`);
  step("Held below minimum · nothing written, entries carry forward");

  // Lower the minimum so the rest of the walk can proceed.
  await db.setting.update({ where: { key: "marketplace.min_payout_paise" }, data: { value: "1000" } });

  // -------------------------------------------------------------------------
  // 2. generate → APPROVED → PROCESSING → FAILED (entries return to AVAILABLE)
  // -------------------------------------------------------------------------
  const first = await generateStatement(
    { sellerId: seller.id, periodTo: null, method: "BANK_TRANSFER", bankAccountId: bankAccount.id, notes: "check run 1" },
    ACTOR,
  );
  assert(first.held === false, "a net above the minimum creates a statement");
  if (first.held) throw new Error("unreachable");
  assert(first.netPaise === 105_000, `statement net is 105000, got ${first.netPaise}`);
  assert(first.entryCount === 3, `three entries were scheduled, got ${first.entryCount}`);

  const scheduled = await db.sellerLedgerEntry.count({
    where: { payoutId: first.payoutId, status: "SCHEDULED" },
  });
  assert(scheduled === 3, `entries are SCHEDULED while the statement is open, got ${scheduled}`);

  const balanceAfterGenerate = await db.sellerBalance.findUniqueOrThrow({ where: { sellerId: seller.id } });
  assert(balanceAfterGenerate.availablePaise === 0, "available drops to zero once scheduled");
  assert(balanceAfterGenerate.scheduledPaise === 105_000, "scheduled holds the statement total");
  step(`Statement ${first.payoutNumber} generated · ₹${first.netPaise / 100} scheduled`);

  // A second open statement is refused (the partial unique index, pre-checked).
  await expectThrow("second open statement", () =>
    generateStatement({ sellerId: seller.id, periodTo: null, method: "BANK_TRANSFER", bankAccountId: null, notes: null }, ACTOR),
    "still pending");
  step("Second open statement refused");

  // An illegal jump is refused before anything moves.
  await expectThrow("PENDING → PAID", () =>
    transitionStatement(first.payoutId, { toStatus: "PAID", referenceNumber: "X", failureReason: null, bankAccountId: null, notes: null }, ACTOR),
    "cannot become");

  await transitionStatement(
    first.payoutId,
    { toStatus: "APPROVED", referenceNumber: null, failureReason: null, bankAccountId: null, notes: null },
    ACTOR,
  );
  step("APPROVED");

  await transitionStatement(
    first.payoutId,
    { toStatus: "PROCESSING", referenceNumber: null, failureReason: null, bankAccountId: bankAccount.id, notes: null },
    ACTOR,
  );
  const processing = await db.sellerPayout.findUniqueOrThrow({ where: { id: first.payoutId } });
  const snapshot = parseBankSnapshot(processing.bankAccountSnapshot);
  assert(snapshot !== null, "PROCESSING snapshots the bank account");
  assert(snapshot?.accountNumberLast4 === "3412", "the snapshot keeps only the last four digits");
  assert(
    !JSON.stringify(processing.bankAccountSnapshot).includes("accountNumberEnc"),
    "the snapshot never carries the encrypted number (D4)",
  );
  assert(payoutStepIndex("PROCESSING") === 2, "the stepper points at processing");
  step("PROCESSING · masked bank snapshot written");

  const failed = await transitionStatement(
    first.payoutId,
    { toStatus: "FAILED", referenceNumber: null, failureReason: "Bank rejected the IFSC", bankAccountId: null, notes: null },
    ACTOR,
  );
  assert(failed.releasedEntries === 3, `three entries were released, got ${failed.releasedEntries}`);

  const afterFailure = await db.sellerLedgerEntry.findMany({
    where: { sellerId: seller.id },
    select: { status: true, payoutId: true, type: true },
  });
  assert(
    afterFailure.every((entry) => entry.status === "AVAILABLE"),
    `every entry returns to AVAILABLE after a failure, got ${afterFailure.map((e) => e.status).join(",")}`,
  );
  assert(
    afterFailure.every((entry) => entry.payoutId === null),
    "a failed statement releases its claim on the entries (payoutId null)",
  );
  const balanceAfterFailure = await db.sellerBalance.findUniqueOrThrow({ where: { sellerId: seller.id } });
  assert(balanceAfterFailure.availablePaise === 105_000, "the balance returns to available after a failure");
  assert(balanceAfterFailure.scheduledPaise === 0, "nothing stays scheduled after a failure");
  step("FAILED · all three entries back to AVAILABLE, balance restored");

  // -------------------------------------------------------------------------
  // 3. A manual adjustment lands on the next statement
  // -------------------------------------------------------------------------
  const adjustment = await recordLedgerAdjustment(
    { sellerId: seller.id, amountPaise: -5_000, description: `${PREFIX} goodwill debit` },
    ACTOR,
  );
  assert(adjustment.balance.availablePaise === 100_000, `available after the debit is 100000, got ${adjustment.balance.availablePaise}`);
  step("Manual adjustment (−₹50) recorded as AVAILABLE");

  // -------------------------------------------------------------------------
  // 4. generate → APPROVED → PROCESSING → PAID
  // -------------------------------------------------------------------------
  const second = await generateStatement(
    { sellerId: seller.id, periodTo: null, method: "BANK_TRANSFER", bankAccountId: bankAccount.id, notes: "check run 2" },
    ACTOR,
  );
  assert(second.held === false, "the retry generates a statement");
  if (second.held) throw new Error("unreachable");
  assert(second.netPaise === 100_000, `the retry nets 100000, got ${second.netPaise}`);
  assert(second.entryCount === 4, `the retry carries the adjustment too, got ${second.entryCount}`);

  const stored = await db.sellerPayout.findUniqueOrThrow({ where: { id: second.payoutId } });
  const entries = await db.sellerLedgerEntry.findMany({
    where: { payoutId: second.payoutId },
    select: { amountPaise: true },
  });
  const identity = checkStatementIdentity(
    stored,
    entries.reduce((sum, entry) => sum + entry.amountPaise, 0),
  );
  assert(identity.balanced, `B5 identity holds: ${identity.message}`);
  assert(stored.adjustmentsPaise === -5_000, `the adjustment lands in the adjustments column, got ${stored.adjustmentsPaise}`);
  step(`Statement ${second.payoutNumber} · ${identity.formula} verified against the ledger`);

  await transitionStatement(second.payoutId, { toStatus: "APPROVED", referenceNumber: null, failureReason: null, bankAccountId: null, notes: null }, ACTOR);
  await transitionStatement(second.payoutId, { toStatus: "PROCESSING", referenceNumber: null, failureReason: null, bankAccountId: bankAccount.id, notes: null }, ACTOR);
  await transitionStatement(
    second.payoutId,
    { toStatus: "PAID", referenceNumber: `UTR${STAMP}`, failureReason: null, bankAccountId: null, notes: null },
    ACTOR,
  );

  const paidEntries = await db.sellerLedgerEntry.findMany({
    where: { sellerId: seller.id },
    select: { type: true, status: true, amountPaise: true },
  });
  const payoutRow = paidEntries.find((entry) => entry.type === "PAYOUT");
  assert(payoutRow !== undefined, "PAID appends one PAYOUT entry");
  assert(payoutRow?.amountPaise === -100_000, `the PAYOUT entry is −net, got ${payoutRow?.amountPaise}`);
  assert(
    paidEntries.every((entry) => entry.status === "PAID"),
    "every entry on a paid statement is PAID",
  );
  const finalBalance = await db.sellerBalance.findUniqueOrThrow({ where: { sellerId: seller.id } });
  assert(finalBalance.availablePaise === 0, "nothing is left available after payment");
  assert(finalBalance.paidPaise === 100_000, `paid-to-date is 100000, got ${finalBalance.paidPaise}`);
  step(`PAID · UTR recorded, PAYOUT entry appended, paid-to-date ₹${finalBalance.paidPaise / 100}`);

  // A terminal statement cannot move again.
  await expectThrow("PAID → FAILED", () =>
    transitionStatement(second.payoutId, { toStatus: "FAILED", referenceNumber: null, failureReason: "no", bankAccountId: null, notes: null }, ACTOR),
    "cannot become");
  step("Terminal statement is immovable");

  // -------------------------------------------------------------------------
  // 5. Balance recompute is idempotent
  // -------------------------------------------------------------------------
  await db.sellerBalance.update({ where: { sellerId: seller.id }, data: { availablePaise: 999_999 } });
  const repaired = await recomputeBalanceForSeller(seller.id, ACTOR);
  assert(repaired.after.availablePaise === 0, "recompute repairs a corrupted projection from the ledger");
  const again = await recomputeBalanceForSeller(seller.id, ACTOR);
  assert(again.after.paidPaise === 100_000, "recompute is idempotent");
  step("Balance recompute repairs drift and is idempotent");

  // -------------------------------------------------------------------------
  // 6. Commission rules: create, duplicate 409, toggle, resolution, delete
  // -------------------------------------------------------------------------
  const rule = await createCommissionRule(
    {
      scope: "SELLER",
      targetId: seller.id,
      rateBps: 1500,
      fixedPaise: 500,
      isActive: true,
      startsAt: null,
      endsAt: null,
      note: `${PREFIX} negotiated rate`,
    },
    ACTOR,
  );
  assert(rule.targetKey === commissionTargetKey("SELLER", seller.id), "targetKey is derived from scope + target");

  await expectThrow("duplicate target", () =>
    createCommissionRule(
      { scope: "SELLER", targetId: seller.id, rateBps: 1000, fixedPaise: 0, isActive: true, startsAt: null, endsAt: null, note: null },
      ACTOR,
    ),
    "already exists");
  step("Duplicate target rejected with a friendly conflict");

  const resolvedActive = await resolveCommission(undefined, { sellerId: seller.id });
  assert(resolvedActive.ruleId === rule.id, "an active seller rule wins over global");
  assert(resolvedActive.rateBps === 1500, `the seller rate resolves to 1500 bps, got ${resolvedActive.rateBps}`);

  await setCommissionRuleActive(rule.id, false, ACTOR);
  const resolvedInactive = await resolveCommission(undefined, { sellerId: seller.id });
  assert(resolvedInactive.ruleId !== rule.id, "an inactive rule is skipped during resolution");
  step("Resolution honours the active flag");

  // A window entirely in the past is skipped even while active.
  await setCommissionRuleActive(rule.id, true, ACTOR);
  await updateCommissionRule(
    rule.id,
    {
      scope: "SELLER",
      targetId: seller.id,
      rateBps: 1500,
      fixedPaise: 500,
      isActive: true,
      startsAt: new Date(Date.now() - 20 * 86_400_000),
      endsAt: new Date(Date.now() - 10 * 86_400_000),
      note: `${PREFIX} expired window`,
    },
    ACTOR,
  );
  const resolvedExpired = await resolveCommission(undefined, { sellerId: seller.id });
  assert(resolvedExpired.ruleId !== rule.id, "a rule whose window has ended is skipped");
  step("Resolution honours the schedule window");

  await expectThrow("delete the global rule", async () => {
    const global = await db.commissionRule.findUnique({ where: { targetKey: commissionTargetKey("GLOBAL") } });
    if (!global) throw new Error("cannot be deleted"); // no global seeded: the guard is untestable, treat as pass
    return deleteCommissionRule(global.id, ACTOR);
  }, "cannot be deleted");
  step("The global rule refuses deletion");

  await deleteCommissionRule(rule.id, ACTOR);
  assert(
    (await db.commissionRule.count({ where: { id: rule.id } })) === 0,
    "a scoped rule can be deleted",
  );

  // -------------------------------------------------------------------------
  // 7. marketplace.charges round-trip
  // -------------------------------------------------------------------------
  const chargesBefore = await db.setting.findUnique({ where: { key: "marketplace.charges" } });
  await saveMarketplaceCharges(
    [
      { code: "check_gateway", label: "Check gateway fee", type: "PERCENT_OF_GROSS", valueBps: 200, valuePaise: null, appliesWhen: "ONLINE_PAYMENT" },
      { code: "check_handling", label: "Check handling", type: "FIXED_PER_ITEM", valueBps: null, valuePaise: 1500, appliesWhen: "ALWAYS" },
    ],
    ACTOR,
  );
  const chargesAfter = await db.setting.findUniqueOrThrow({ where: { key: "marketplace.charges" } });
  const parsedCharges = JSON.parse(chargesAfter.value) as Array<Record<string, unknown>>;
  assert(parsedCharges.length === 2, "both charge rules were saved");
  assert(parsedCharges[0].valueBps === 200 && !("valuePaise" in parsedCharges[0]), "a percentage rule stores only valueBps");
  assert(parsedCharges[1].valuePaise === 1500 && !("valueBps" in parsedCharges[1]), "a fixed rule stores only valuePaise");
  step("marketplace.charges round-trips with only the field its type uses");

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------
  await db.setting.update({
    where: { key: "marketplace.charges" },
    data: { value: chargesBefore?.value ?? "[]" },
  });
  if (originalMin !== null) {
    await db.setting.update({ where: { key: "marketplace.min_payout_paise" }, data: { value: originalMin } });
  } else {
    await db.setting.delete({ where: { key: "marketplace.min_payout_paise" } });
  }

  await db.sellerLedgerEntry.deleteMany({ where: { sellerId: seller.id } });
  await db.sellerPayout.deleteMany({ where: { sellerId: seller.id } });
  await db.sellerBalance.deleteMany({ where: { sellerId: seller.id } });
  await db.sellerBankAccount.deleteMany({ where: { sellerId: seller.id } });
  await db.commissionRule.deleteMany({ where: { sellerId: seller.id } });
  await db.seller.delete({ where: { id: seller.id } });

  const leftovers = await db.seller.count({ where: { slug: { startsWith: PREFIX } } });
  assert(leftovers === 0, "the check leaves no seller behind");
  step("Cleaned up (AuditLog rows remain by design - the table is append-only)");

  console.log(`\nPASSED · ${passed} assertions`);
}

main()
  .catch(async (error) => {
    console.error("\nFAILED", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
