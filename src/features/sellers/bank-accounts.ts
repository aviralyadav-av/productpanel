import type { SellerBankAccount } from "@prisma/client";

import { conflict, notFound } from "@/lib/api/errors";
import { writeAudit } from "@/lib/audit";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { decrypt, encrypt, last4 } from "@/lib/crypto";
import { db } from "@/lib/db";
import { OPEN_PAYOUT_STATUSES } from "@/lib/enums";

import { maybeAutoActivate, requireSeller, type Db, type SellerActor } from "@/features/sellers/core";
import type { BankAccountUpdateValues, BankAccountValues } from "@/features/sellers/schemas";

/**
 * Seller bank accounts (blueprint §4.4, §14.D4, D13).
 *
 * The account number is AES-256-GCM encrypted with the `bank` purpose and
 * only `accountNumberLast4` is ever listed. `decrypt` is called in exactly one
 * place - `revealBankAccount` - which requires `payouts.process` at the caller
 * and writes a `seller.bank_reveal` audit row in the same transaction: no
 * audit row, no number.
 */

/** Everything the UI may see; never the encrypted column. */
export type BankAccountMutationResult = Omit<SellerBankAccount, "accountNumberEnc">;

function strip(row: SellerBankAccount): BankAccountMutationResult {
  const { accountNumberEnc: _enc, ...rest } = row;
  void _enc;
  return rest;
}

async function requireAccount(tx: Db, sellerId: string, accountId: string): Promise<SellerBankAccount> {
  const account = await tx.sellerBankAccount.findFirst({ where: { id: accountId, sellerId } });
  if (!account) throw notFound("Bank account");
  return account;
}

async function clearPrimary(tx: Db, sellerId: string, exceptId?: string): Promise<void> {
  await tx.sellerBankAccount.updateMany({
    where: { sellerId, isPrimary: true, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    data: { isPrimary: false },
  });
}

export async function addBankAccount(
  sellerId: string,
  input: BankAccountValues,
  actor: SellerActor,
): Promise<{ account: BankAccountMutationResult; autoActivated: boolean }> {
  const result = await db.$transaction(async (tx) => {
    const seller = await requireSeller(tx, sellerId);
    const existing = await tx.sellerBankAccount.count({ where: { sellerId } });
    // The first account is primary whatever the form said: a seller with one
    // account and no primary would never be payable.
    const isPrimary = input.isPrimary || existing === 0;
    if (isPrimary) await clearPrimary(tx, sellerId);

    const account = await tx.sellerBankAccount.create({
      data: {
        sellerId,
        accountHolder: input.accountHolder,
        bankName: input.bankName,
        accountNumberEnc: encrypt(input.accountNumber, "bank"),
        accountNumberLast4: last4(input.accountNumber) ?? "",
        ifsc: input.ifsc,
        upiId: input.upiId ?? null,
        isPrimary,
        isVerified: false,
      },
    });

    await writeAudit(tx, {
      actor,
      action: "seller.bank_change",
      entityType: "Seller",
      entityId: sellerId,
      entityLabel: seller.displayName,
      summary: `Added ${account.bankName} account ending ${account.accountNumberLast4} for "${seller.displayName}"${
        isPrimary ? " (primary)" : ""
      }.`,
      diff: { accountId: account.id, bankName: account.bankName, last4: account.accountNumberLast4, ifsc: account.ifsc, isPrimary },
    });

    const autoActivated = isPrimary ? await maybeAutoActivate(tx, sellerId, actor) : false;
    return { account: strip(account), autoActivated };
  });

  if (result.autoActivated) await invalidatePublic(listTagsFor("seller"));
  return result;
}

/**
 * Edits keep the stored number unless a new one is typed. Changing the number
 * or IFSC un-verifies the account: the verification was of the old details.
 */
export async function updateBankAccount(
  sellerId: string,
  accountId: string,
  input: BankAccountUpdateValues,
  actor: SellerActor,
): Promise<BankAccountMutationResult> {
  return db.$transaction(async (tx) => {
    const seller = await requireSeller(tx, sellerId);
    const before = await requireAccount(tx, sellerId, accountId);
    const numberChanged = Boolean(input.accountNumber);
    const detailsChanged = numberChanged || input.ifsc !== before.ifsc;

    const account = await tx.sellerBankAccount.update({
      where: { id: before.id },
      data: {
        accountHolder: input.accountHolder,
        bankName: input.bankName,
        ifsc: input.ifsc,
        upiId: input.upiId ?? null,
        ...(numberChanged
          ? {
              accountNumberEnc: encrypt(input.accountNumber as string, "bank"),
              accountNumberLast4: last4(input.accountNumber) ?? "",
            }
          : {}),
        ...(detailsChanged ? { isVerified: false } : {}),
      },
    });

    await writeAudit(tx, {
      actor,
      action: "seller.bank_change",
      entityType: "Seller",
      entityId: sellerId,
      entityLabel: seller.displayName,
      summary: `Updated ${account.bankName} account ending ${account.accountNumberLast4} for "${seller.displayName}"${
        numberChanged ? " (number replaced)" : ""
      }.`,
      diff: {
        accountId: account.id,
        accountHolder: { from: before.accountHolder, to: account.accountHolder },
        bankName: { from: before.bankName, to: account.bankName },
        ifsc: { from: before.ifsc, to: account.ifsc },
        upiId: { from: before.upiId, to: account.upiId },
        last4: { from: before.accountNumberLast4, to: account.accountNumberLast4 },
        isVerified: { from: before.isVerified, to: account.isVerified },
      },
    });

    return strip(account);
  });
}

export async function setPrimaryBankAccount(
  sellerId: string,
  accountId: string,
  actor: SellerActor,
): Promise<{ account: BankAccountMutationResult; autoActivated: boolean }> {
  const result = await db.$transaction(async (tx) => {
    const seller = await requireSeller(tx, sellerId);
    const target = await requireAccount(tx, sellerId, accountId);
    await clearPrimary(tx, sellerId, target.id);
    const account = await tx.sellerBankAccount.update({ where: { id: target.id }, data: { isPrimary: true } });

    await writeAudit(tx, {
      actor,
      action: "seller.bank_change",
      entityType: "Seller",
      entityId: sellerId,
      entityLabel: seller.displayName,
      summary: `Made ${account.bankName} account ending ${account.accountNumberLast4} the primary payout account for "${seller.displayName}".`,
      diff: { accountId: account.id, last4: account.accountNumberLast4, isPrimary: { from: target.isPrimary, to: true } },
    });

    const autoActivated = await maybeAutoActivate(tx, sellerId, actor);
    return { account: strip(account), autoActivated };
  });

  if (result.autoActivated) await invalidatePublic(listTagsFor("seller"));
  return result;
}

export async function verifyBankAccount(
  sellerId: string,
  accountId: string,
  actor: SellerActor,
): Promise<BankAccountMutationResult> {
  return db.$transaction(async (tx) => {
    const seller = await requireSeller(tx, sellerId);
    const before = await requireAccount(tx, sellerId, accountId);
    const account = await tx.sellerBankAccount.update({ where: { id: before.id }, data: { isVerified: true } });
    await writeAudit(tx, {
      actor,
      action: "seller.bank_change",
      entityType: "Seller",
      entityId: sellerId,
      entityLabel: seller.displayName,
      summary: `Verified ${account.bankName} account ending ${account.accountNumberLast4} for "${seller.displayName}".`,
      diff: { accountId: account.id, last4: account.accountNumberLast4, isVerified: { from: before.isVerified, to: true } },
    });
    return strip(account);
  });
}

/**
 * Refused while any payout statement references the account - the statement's
 * bank snapshot is written at PROCESSING, and an open statement still needs
 * the live row. When the primary goes, the oldest remaining account inherits
 * the flag so the seller stays payable.
 */
export async function deleteBankAccount(sellerId: string, accountId: string, actor: SellerActor): Promise<void> {
  await db.$transaction(async (tx) => {
    const seller = await requireSeller(tx, sellerId);
    const account = await requireAccount(tx, sellerId, accountId);

    const [openPayouts, anyPayouts] = await Promise.all([
      tx.sellerPayout.count({ where: { bankAccountId: account.id, status: { in: [...OPEN_PAYOUT_STATUSES] } } }),
      tx.sellerPayout.count({ where: { bankAccountId: account.id } }),
    ]);
    if (anyPayouts > 0) {
      throw conflict(
        `This account is referenced by ${anyPayouts} payout statement${anyPayouts === 1 ? "" : "s"}${
          openPayouts > 0 ? ` (${openPayouts} still open)` : ""
        } and cannot be deleted.`,
      );
    }

    await tx.sellerBankAccount.delete({ where: { id: account.id } });

    let promoted: string | null = null;
    if (account.isPrimary) {
      const next = await tx.sellerBankAccount.findFirst({ where: { sellerId }, orderBy: { createdAt: "asc" } });
      if (next) {
        await tx.sellerBankAccount.update({ where: { id: next.id }, data: { isPrimary: true } });
        promoted = next.accountNumberLast4;
      }
    }

    await writeAudit(tx, {
      actor,
      action: "seller.bank_change",
      entityType: "Seller",
      entityId: sellerId,
      entityLabel: seller.displayName,
      summary: `Deleted ${account.bankName} account ending ${account.accountNumberLast4} for "${seller.displayName}"${
        promoted ? `; account ending ${promoted} is now primary` : ""
      }.`,
      diff: { accountId: account.id, last4: account.accountNumberLast4, wasPrimary: account.isPrimary, promotedLast4: promoted },
    });
  });
}

export type RevealedBankAccount = {
  id: string;
  accountHolder: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  upiId: string | null;
};

/**
 * The one decrypt path (D4). Audited inside the transaction so a failure to
 * record the reveal means the number is not returned.
 */
export async function revealBankAccount(
  sellerId: string,
  accountId: string,
  actor: SellerActor,
  client: { ip?: string | null; userAgent?: string | null } = {},
): Promise<RevealedBankAccount> {
  return db.$transaction(async (tx) => {
    const seller = await requireSeller(tx, sellerId);
    const account = await requireAccount(tx, sellerId, accountId);

    await writeAudit(tx, {
      actor,
      action: "seller.bank_reveal",
      entityType: "Seller",
      entityId: sellerId,
      entityLabel: seller.displayName,
      summary: `Revealed ${account.bankName} account ending ${account.accountNumberLast4} for "${seller.displayName}".`,
      diff: { accountId: account.id, last4: account.accountNumberLast4 },
      ip: client.ip ?? null,
      userAgent: client.userAgent ?? null,
    });

    return {
      id: account.id,
      accountHolder: account.accountHolder,
      bankName: account.bankName,
      accountNumber: decrypt(account.accountNumberEnc, "bank"),
      ifsc: account.ifsc,
      upiId: account.upiId,
    };
  });
}
