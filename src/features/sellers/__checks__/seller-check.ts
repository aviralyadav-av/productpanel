import "dotenv/config";

import { db } from "@/lib/db";
import { isEncrypted } from "@/lib/crypto";

import {
  addBankAccount,
  createSeller,
  deleteBankAccount,
  deleteCommissionOverride,
  getSellerCommission,
  recomputeSellerCounters,
  resetSellerAccess,
  revealBankAccount,
  reviewSellerDocument,
  softDeleteSeller,
  transitionSeller,
  updateSeller,
  upsertCommissionOverride,
} from "@/features/sellers/service";
import { addSellerDocument, ensureSellerMediaFolder } from "@/features/sellers/documents";

/**
 * End-to-end check against the REAL database:
 *
 *   npx tsx src/features/sellers/__checks__/seller-check.ts
 *
 * Creates a `check_` seller, walks PENDING → UNDER_REVIEW → APPROVED → ACTIVE
 * → SUSPENDED → ACTIVE (asserting SellerEvent + AuditLog rows and the
 * reason rule), adds + reveals a bank account (asserting the number is
 * encrypted at rest and the reveal is audited), sets and removes a commission
 * override, issues a reset token, then soft-deletes and cleans up. Every row
 * it creates is removed at the end, including the ones the soft delete keeps.
 */

const STAMP = Date.now();
const ACTOR = { id: "system", email: "system@diybaazar.local" };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

async function expectThrow(label: string, fn: () => Promise<unknown>, contains?: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (contains) {
      const message = error instanceof Error ? error.message : String(error);
      assert(message.toLowerCase().includes(contains.toLowerCase()), `${label}: expected "${contains}" in "${message}"`);
    }
    return;
  }
  throw new Error(`ASSERT FAILED: ${label} should have thrown`);
}

async function main(): Promise<void> {
  const email = `check-${STAMP}@check.local`;
  const slug = `check-seller-${STAMP}`;
  let sellerId: string | null = null;
  let mediaId: string | null = null;

  try {
    // 1. Create PENDING with an initial commission override.
    const created = await createSeller(
      {
        profile: {
          displayName: `Check Seller ${STAMP}`,
          slug,
          legalName: "Check Seller Pvt Ltd",
          ownerName: "Check Owner",
          email,
          phone: "+919876543210",
          description: null,
          addressLine1: "1 Test Lane",
          addressLine2: null,
          city: "Pune",
          state: "Maharashtra",
          pinCode: "411001",
          country: "IN",
          gstin: "27AAPFU0939F1ZV",
          pan: "AAPFU0939F",
          logoMediaId: null,
          bannerMediaId: null,
        },
        initialStatus: "PENDING",
        commissionBps: 1250,
      },
      ACTOR,
    );
    sellerId = created.seller.id;
    assert(created.seller.status === "PENDING", "starts PENDING");
    assert(created.commissionRuleId, "override rule created");
    console.log("created", sellerId);

    const commission = await getSellerCommission(sellerId);
    assert(commission.resolved.rateBps === 1250 && commission.resolved.scope === "SELLER", "SELLER rule resolves over GLOBAL");

    // 2. Illegal edge and missing reason are refused.
    await expectThrow("PENDING -> ACTIVE", () => transitionSeller({ sellerId: sellerId!, toStatus: "ACTIVE", actor: ACTOR }), "cannot be moved");
    await expectThrow("REJECTED without reason", () => transitionSeller({ sellerId: sellerId!, toStatus: "REJECTED", actor: ACTOR }));

    // 3. Walk the happy path.
    await transitionSeller({ sellerId, toStatus: "UNDER_REVIEW", actor: ACTOR });
    const approved = await transitionSeller({ sellerId, toStatus: "APPROVED", actor: ACTOR, activate: true });
    assert(approved.seller.status === "APPROVED" && approved.activationSkipped, "activation skipped without KYC + bank");

    // 3a. A verified document + primary bank auto-activates (C5).
    const folderId = await ensureSellerMediaFolder(db, slug);
    const media = await db.mediaAsset.create({
      data: {
        url: `pending:check/${STAMP}.pdf`,
        storageKey: `check/${STAMP}.pdf`,
        storageProvider: "local",
        visibility: "PRIVATE",
        filename: "check.pdf",
        kind: "document",
        mimeType: "application/pdf",
        sizeBytes: 10,
        folderId,
      },
    });
    mediaId = media.id;
    const document = await db.$transaction((tx) =>
      addSellerDocument(tx, { sellerId: sellerId!, type: "PAN", label: "PAN card", mediaId: media.id, actor: ACTOR, source: "admin" }),
    );
    const reviewed = await reviewSellerDocument({ sellerId, documentId: document.id, status: "VERIFIED", note: "ok", actor: ACTOR });
    assert(!reviewed.autoActivated, "no bank yet: not activated");

    const bank = await addBankAccount(
      sellerId,
      { accountHolder: "Check Owner", bankName: "HDFC Bank", accountNumber: "123456789012", ifsc: "HDFC0001234", upiId: null, isPrimary: true },
      ACTOR,
    );
    assert(bank.autoActivated, "primary bank + verified doc auto-activates");
    assert(bank.account.accountNumberLast4 === "9012", "last4 stored");
    const stored = await db.sellerBankAccount.findUniqueOrThrow({ where: { id: bank.account.id } });
    assert(isEncrypted(stored.accountNumberEnc) && !stored.accountNumberEnc.includes("123456789012"), "number encrypted at rest");

    let seller = await db.seller.findUniqueOrThrow({ where: { id: sellerId } });
    assert(seller.status === "ACTIVE", `now ACTIVE (got ${seller.status})`);

    // 4. Suspend (reason required) and reinstate.
    await transitionSeller({ sellerId, toStatus: "SUSPENDED", actor: ACTOR, reason: "Check suspension" });
    seller = await db.seller.findUniqueOrThrow({ where: { id: sellerId } });
    assert(seller.status === "SUSPENDED" && seller.suspensionReason === "Check suspension", "suspended with reason");
    await transitionSeller({ sellerId, toStatus: "ACTIVE", actor: ACTOR });
    seller = await db.seller.findUniqueOrThrow({ where: { id: sellerId } });
    assert(seller.status === "ACTIVE" && seller.suspensionReason === null, "reinstated");

    const events = await db.sellerEvent.findMany({ where: { sellerId }, orderBy: { createdAt: "asc" } });
    const path = events.map((event) => event.toStatus);
    assert(
      JSON.stringify(path) === JSON.stringify(["PENDING", "UNDER_REVIEW", "APPROVED", "ACTIVE", "SUSPENDED", "ACTIVE"]),
      `event path ${path.join(" -> ")}`,
    );
    const statusAudits = await db.auditLog.count({ where: { entityType: "Seller", entityId: sellerId, action: "seller.status_change" } });
    assert(statusAudits === 5, `5 status audits (got ${statusAudits})`);

    // 5. Reveal is audited and returns the plaintext.
    const revealed = await revealBankAccount(sellerId, bank.account.id, ACTOR);
    assert(revealed.accountNumber === "123456789012", "reveal decrypts");
    const revealAudit = await db.auditLog.count({ where: { entityType: "Seller", entityId: sellerId, action: "seller.bank_reveal" } });
    assert(revealAudit === 1, "reveal audited");

    // 6. Commission override edit + removal, profile update, reset access, counters.
    await upsertCommissionOverride(sellerId, { rateBps: 800, fixedPaise: 500, note: "check" }, ACTOR);
    assert((await getSellerCommission(sellerId)).resolved.rateBps === 800, "override updated");
    await deleteCommissionOverride(sellerId, ACTOR);
    assert((await getSellerCommission(sellerId)).override === null, "override removed");

    await updateSeller(sellerId, { ...seller, description: "Updated", country: "IN" } as never, ACTOR);
    const reset = await resetSellerAccess(sellerId, ACTOR);
    assert(reset.expiresAt.getTime() > Date.now(), "reset token issued");
    assert((await db.sellerPasswordResetToken.count({ where: { sellerId } })) === 1, "one reset token");

    const counters = await db.$transaction((tx) => recomputeSellerCounters(tx, sellerId!));
    assert(counters.productCount === 0 && counters.grossSalesPaise === 0, "counters recomputed");

    // 7. Bank delete, then soft delete frees slug/email.
    await deleteBankAccount(sellerId, bank.account.id, ACTOR);
    const deleted = await softDeleteSeller(sellerId, ACTOR, "check cleanup");
    assert(deleted.deletedAt && deleted.slug.startsWith(`${slug}-deleted-`) && deleted.email.endsWith("@deleted.local"), "soft-deleted with suffixes");

    console.log("SELLER CHECK PASSED");
  } finally {
    if (sellerId) {
      await db.sellerPasswordResetToken.deleteMany({ where: { sellerId } });
      await db.sellerDocument.deleteMany({ where: { sellerId } });
      await db.sellerBankAccount.deleteMany({ where: { sellerId } });
      await db.commissionRule.deleteMany({ where: { sellerId } });
      await db.sellerEvent.deleteMany({ where: { sellerId } });
      await db.sellerBalance.deleteMany({ where: { sellerId } });
      await db.seller.deleteMany({ where: { id: sellerId } });
    }
    if (mediaId) await db.mediaAsset.deleteMany({ where: { id: mediaId } });
    await db.mediaFolder.deleteMany({ where: { path: `sellers/${slug}` } });
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
