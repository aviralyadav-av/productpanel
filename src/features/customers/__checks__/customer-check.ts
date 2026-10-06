import "dotenv/config";

import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";
import { SYSTEM_ACTOR } from "@/lib/audit";
import { hashToken, randomToken } from "@/lib/crypto";

import { anonymisedEmail } from "@/features/customers/domain";
import {
  completeCustomerPasswordReset,
  getIntegrationCustomer,
  recordLoginEvent,
  replaceWishlist,
  upsertCart,
  upsertCustomerFromIntegration,
  verifyCustomerCredentials,
} from "@/features/customers/integration-service";
import {
  createAddress,
  createCustomer,
  recomputeCustomerCounters,
  requestCustomerPasswordReset,
  setCustomerStatus,
  softDeleteCustomer,
  updateCustomer,
} from "@/features/customers/service";

/**
 * End-to-end service check against the REAL seeded database:
 *
 *   npx tsx src/features/customers/__checks__/customer-check.ts
 *
 * Walks one throwaway customer (email prefixed `check_`) through the whole
 * lifecycle the admin and the website can trigger: create with an address,
 * default-per-type address rules, case-insensitive email uniqueness, phone
 * normalisation, website login mirroring, block (reason required, sessions
 * revoked), admin password reset (hashed 60-minute token), website password
 * reset completion, wishlist/cart sync, counter recompute (rolled back), and
 * finally the soft delete / anonymisation from blueprint E7. The customer
 * row is hard-deleted at the end; audit rows are append-only and stay.
 */

const CHECK_EMAIL_PREFIX = "check_customer_";
const ACTOR = { ...SYSTEM_ACTOR, email: "customer-check@local" };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

async function expectApiError(promise: Promise<unknown>, status: number, label: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    assert(error instanceof ApiError, `${label}: threw an ApiError (got ${String(error)})`);
    assert(error.status === status, `${label}: status ${status} (got ${error.status} ${error.message})`);
    return;
  }
  throw new Error(`ASSERT FAILED: ${label}: expected a ${status} error but the call succeeded`);
}

async function cleanupLeftovers(): Promise<void> {
  const leftovers = await db.customer.findMany({ where: { email: { startsWith: CHECK_EMAIL_PREFIX } }, select: { id: true } });
  if (leftovers.length > 0) await db.customer.deleteMany({ where: { id: { in: leftovers.map((row) => row.id) } } });
}

async function main(): Promise<void> {
  await cleanupLeftovers();
  const stamp = Date.now().toString(36);
  const email = `${CHECK_EMAIL_PREFIX}${stamp}@example.test`;
  let customerId: string | null = null;

  try {
    // --- create (with initial address) -----------------------------------------------
    const created = await createCustomer(
      {
        fullName: "Check Customer",
        email: email.toUpperCase(),
        phone: "98765 43210",
        acceptsMarketing: true,
        tags: ["Check", "check", "VIP Test"],
        notes: "Created by customer-check.ts",
        address: { label: "Home", fullName: "Check Customer", phone: null, line1: "12 MG Road", line2: null, landmark: null, city: "Bengaluru", state: "Karnataka", pinCode: "560001", country: "IN", type: "BOTH", isDefault: false },
      },
      ACTOR,
    );
    customerId = created.id;
    assert(created.email === email, `email normalised to lower case (${created.email})`);
    assert(created.phone === "+919876543210", `phone normalised to +91 (${created.phone})`);
    assert(created.tags.join(",") === "check,vip test", `tags de-duplicated and lower-cased (${created.tags.join(",")})`);
    const firstAddress = await db.address.findFirstOrThrow({ where: { customerId: created.id } });
    assert(firstAddress.isDefault, "the first address is the default even when isDefault=false was sent");
    console.log(`created ${created.id} <${created.email}> with default address in ${firstAddress.city}`);

    // --- uniqueness + update -----------------------------------------------------------
    await expectApiError(createCustomer({ fullName: null, email: email.replace("@", "@").toUpperCase(), phone: null, acceptsMarketing: false, tags: [], notes: null }, ACTOR), 409, "duplicate email (different case)");
    const updated = await updateCustomer(created.id, { fullName: "Check Customer II", tags: ["check", "wholesale"] }, ACTOR);
    assert(updated.fullName === "Check Customer II" && updated.tags.includes("wholesale"), "profile patch applied");

    // --- default per type -----------------------------------------------------------------
    const shipping = await createAddress(created.id, { label: "Office", fullName: "Check Customer", phone: null, line1: "1 Residency Rd", line2: null, landmark: null, city: "Bengaluru", state: "Karnataka", pinCode: "560025", country: "IN", type: "SHIPPING", isDefault: true }, ACTOR);
    const afterShipping = await db.address.findMany({ where: { customerId: created.id }, select: { id: true, type: true, isDefault: true } });
    assert(afterShipping.find((row) => row.id === shipping.id)?.isDefault === true, "new default SHIPPING is default");
    assert(afterShipping.find((row) => row.id === firstAddress.id)?.isDefault === false, "a default SHIPPING displaces the BOTH default");

    // --- website login mirrored as a session ---------------------------------------------
    const sessionToken = randomToken(24);
    const login = await recordLoginEvent(email, { ip: "203.0.113.7", userAgent: "customer-check", sessionToken });
    assert(login.customerId === created.id, "login event resolved the customer by email");
    const liveBefore = await db.customerSession.count({ where: { customerId: created.id, revokedAt: null } });
    assert(liveBefore === 1, `one live session after login (${liveBefore})`);
    // The website may replay a login event for a session it already sent; the
    // unique tokenHash must not turn that into a 500 or a duplicate row.
    const replay = await recordLoginEvent(email, { ip: "203.0.113.7", userAgent: "customer-check", sessionToken });
    assert(replay.sessionId === login.sessionId, "replaying a login event updates the same session row");
    assert((await db.customerSession.count({ where: { customerId: created.id } })) === 1, "no duplicate session row on replay");

    // --- profile read used by the website (D11 allowlist) ------------------------------
    const profile = await getIntegrationCustomer(email.toUpperCase());
    assert(profile?.id === created.id, "integration profile resolved case-insensitively");
    assert(profile.addresses.length === 2 && profile.addresses[0]?.isDefault === true, "integration profile lists addresses, default first");
    assert(!("notes" in profile) && !("tags" in profile) && !("passwordHash" in profile), "integration profile omits staff-only fields and hashes");

    // --- block / unblock ------------------------------------------------------------------
    await expectApiError(setCustomerStatus(created.id, "BLOCKED", ACTOR), 400, "block without a reason");
    const blocked = await setCustomerStatus(created.id, "BLOCKED", ACTOR, { reason: "customer-check" });
    assert(blocked.status === "BLOCKED", "customer is BLOCKED");
    assert((await db.customerSession.count({ where: { customerId: created.id, revokedAt: null } })) === 0, "blocking revoked every live session");
    await expectApiError(requestCustomerPasswordReset(created.id, ACTOR), 400, "password reset while blocked");
    await expectApiError(recordLoginEvent(email, {}), 400, "login event while blocked");
    const unblocked = await setCustomerStatus(created.id, "ACTIVE", ACTOR);
    assert(unblocked.status === "ACTIVE", "customer is ACTIVE again");

    // --- admin-triggered reset token ---------------------------------------------------------
    const reset = await requestCustomerPasswordReset(created.id, ACTOR);
    const tokenRow = await db.customerPasswordResetToken.findFirstOrThrow({ where: { customerId: created.id, usedAt: null } });
    const ttlMinutes = Math.round((tokenRow.expiresAt.getTime() - Date.now()) / 60_000);
    assert(ttlMinutes >= 59 && ttlMinutes <= 60, `reset token lives ~60 minutes (${ttlMinutes})`);
    assert(/^[a-f0-9]{64}$/.test(tokenRow.tokenHash), "reset token is stored as a SHA-256 hash");
    console.log(`reset link expires ${reset.expiresAt.toISOString()} (email queued: ${reset.emailQueued})`);

    // --- website: password storage + verify-credentials -------------------------------------
    const synced = await upsertCustomerFromIntegration({ email: email.toUpperCase(), password: "correct-horse-battery", acceptsMarketing: false });
    assert(!synced.created && synced.customer.id === created.id, "integration upsert matched the existing row case-insensitively");
    assert(synced.customer.hasPassword, "password hash stored");
    assert((await verifyCustomerCredentials(email, "correct-horse-battery")).ok, "correct password verifies");
    assert(!(await verifyCustomerCredentials(email, "wrong-password")).ok, "wrong password fails");
    assert(!(await verifyCustomerCredentials(`nobody_${stamp}@example.test`, "whatever")).ok, "unknown email fails");

    // --- website: complete a reset with a token we mint ourselves ---------------------------
    const plaintext = randomToken(32);
    await db.customerPasswordResetToken.create({ data: { customerId: created.id, tokenHash: hashToken(plaintext), expiresAt: new Date(Date.now() + 10 * 60_000) } });
    await recordLoginEvent(email, {});
    const completed = await completeCustomerPasswordReset(plaintext, "new-password-123");
    assert(completed.customerId === created.id, "reset completion resolved the customer");
    assert((await verifyCustomerCredentials(email, "new-password-123")).ok, "new password verifies");
    assert(!(await verifyCustomerCredentials(email, "correct-horse-battery")).ok, "old password no longer verifies");
    assert((await db.customerSession.count({ where: { customerId: created.id, revokedAt: null } })) === 0, "reset completion revoked sessions");
    assert((await db.customerPasswordResetToken.count({ where: { customerId: created.id, usedAt: null } })) === 0, "sibling unused tokens dropped");
    await expectApiError(completeCustomerPasswordReset(plaintext, "another-password-1"), 400, "token reuse");

    // --- website: wishlist + cart sync -------------------------------------------------------
    const product = await db.product.findFirstOrThrow({ where: { id: { startsWith: "demo_prod_" }, status: "PUBLISHED", deletedAt: null, variants: { some: { isActive: true, deletedAt: null } } }, select: { id: true } });
    const wishlist = await replaceWishlist(email, { items: [{ productId: product.id }, { productId: product.id }, { productId: "nope_missing" }] });
    assert(wishlist.items.length === 1 && wishlist.items[0]?.variantId, "wishlist resolved the default variant and de-duplicated");
    assert(wishlist.skipped.length === 1, "unknown product skipped, not fatal");
    const cart = await upsertCart(`check_cart_${stamp}`, { email, items: [{ productId: product.id, quantity: 2 }, { productId: product.id, quantity: 1 }] });
    assert(cart.customerId === created.id && cart.status === "ACTIVE", "cart linked to the customer and ACTIVE");
    assert(cart.items.length === 1 && cart.items[0]?.quantity === 3, "identical plain cart lines merged");

    // --- counters (C7) on a demo customer, rolled back ----------------------------------------
    const demo = await db.customer.findFirstOrThrow({ where: { id: { startsWith: "demo_" }, orderCount: { gt: 0 } }, select: { id: true, orderCount: true, totalSpentPaise: true } });
    await db
      .$transaction(async (tx) => {
        const counters = await recomputeCustomerCounters(tx, demo.id);
        assert(counters.orderCount > 0 && counters.totalSpentPaise >= 0 && counters.firstOrderAt && counters.lastOrderAt, "recompute returned sane counters");
        console.log(`recompute ${demo.id}: seed ${demo.orderCount}/${demo.totalSpentPaise} -> computed ${counters.orderCount}/${counters.totalSpentPaise} (rolled back)`);
        throw new Error("ROLLBACK");
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== "ROLLBACK") throw error;
      });

    // --- soft delete / anonymise (E7) ------------------------------------------------------------
    const deleted = await softDeleteCustomer(created.id, ACTOR, { reason: "customer-check" });
    const raw = await db.customer.findUniqueOrThrow({ where: { id: created.id } });
    assert(deleted.deletedAt && raw.email === anonymisedEmail(created.id), `email anonymised (${raw.email})`);
    assert(raw.deletedEmailHash === hashToken(email), "original email kept only as a hash");
    assert(raw.phone === null && raw.passwordHash === null && raw.acceptsMarketing === false, "phone, password and consent cleared");
    assert((await db.address.count({ where: { customerId: created.id } })) === 0, "addresses removed");
    assert((await db.wishlist.count({ where: { customerId: created.id } })) === 0, "wishlist removed");
    assert((await db.cart.count({ where: { customerId: created.id } })) === 0, "carts removed");
    assert((await db.customerPasswordResetToken.count({ where: { customerId: created.id } })) === 0, "reset tokens removed");
    assert((await db.customerSession.count({ where: { customerId: created.id, revokedAt: null } })) === 0, "sessions revoked");
    await expectApiError(updateCustomer(created.id, { fullName: "Ghost" }, ACTOR), 404, "deleted customers are read-only");

    const audit = await db.auditLog.count({ where: { entityType: "customer", entityId: created.id } });
    assert(audit >= 8, `audit trail written (${audit} rows)`);
    console.log(`audit rows for the check customer: ${audit}`);

    console.log("customer-check: all assertions passed");
  } finally {
    if (customerId) await db.customer.deleteMany({ where: { id: customerId } });
    await cleanupLeftovers();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
