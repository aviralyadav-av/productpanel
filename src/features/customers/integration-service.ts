import type { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

import { db } from "@/lib/db";
import { badRequest, notFound } from "@/lib/api/errors";
import { SYSTEM_ACTOR, writeAudit } from "@/lib/audit";
import { hashToken, randomToken } from "@/lib/crypto";
import { emitEvent } from "@/features/notifications/service";

import { normaliseEmail } from "./domain";
import type {
  IntegrationCartInput,
  IntegrationLoginEventInput,
  IntegrationUpsertInput,
  IntegrationWishlistInput,
} from "./schemas";
import {
  ADDRESS_SELECT,
  CUSTOMER_CORE_SELECT,
  findCustomerByEmail,
  normalisePhoneValue,
  revokeCustomerSessions,
  type AddressRecord,
  type CustomerCore,
} from "./service";

/**
 * What the separately built website writes to us (blueprint E7, 5.3 scope
 * note). Authenticated by the storefront key at the route layer; this file
 * only knows about customers. No `server-only`, no `next/*`.
 *
 * Passwords: bcrypt cost 12 (same as admin accounts). The website may keep
 * its own auth and never send a password - every function here works with a
 * null passwordHash.
 */

type Tx = Prisma.TransactionClient;
const BCRYPT_ROUNDS = 12;
const CART_TTL_DAYS = 30;
const SESSION_TTL_DAYS = 30;

/**
 * A real bcrypt hash of a random string, computed once per process, so a
 * failed lookup still pays for one compare. Without it "unknown email" would
 * answer in 1 ms and "wrong password" in 100 ms - a user-enumeration oracle.
 */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= bcrypt.hash(randomToken(16), BCRYPT_ROUNDS);
  return dummyHashPromise;
}

// ---------------------------------------------------------------------------
// Serialiser (D11 allowlist - never spread the row)
// ---------------------------------------------------------------------------

export type IntegrationCustomer = {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  status: string;
  emailVerifiedAt: string | null;
  acceptsMarketing: boolean;
  hasPassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  counters: { orderCount: number; totalSpentPaise: number; firstOrderAt: string | null; lastOrderAt: string | null };
  addresses: IntegrationAddress[];
};

export type IntegrationAddress = {
  id: string;
  label: string | null;
  fullName: string;
  phone: string | null;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pinCode: string;
  country: string;
  type: string;
  isDefault: boolean;
};

const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

export function serializeIntegrationAddress(address: AddressRecord): IntegrationAddress {
  return {
    id: address.id,
    label: address.label,
    fullName: address.fullName,
    phone: address.phone,
    line1: address.line1,
    line2: address.line2,
    landmark: address.landmark,
    city: address.city,
    state: address.state,
    pinCode: address.pinCode,
    country: address.country,
    type: address.type,
    isDefault: address.isDefault,
  };
}

export function serializeIntegrationCustomer(customer: CustomerCore & { passwordHash?: string | null }, addresses: AddressRecord[]): IntegrationCustomer {
  return {
    id: customer.id,
    email: customer.email,
    fullName: customer.fullName,
    phone: customer.phone,
    status: customer.status,
    emailVerifiedAt: iso(customer.emailVerifiedAt),
    acceptsMarketing: customer.acceptsMarketing,
    hasPassword: Boolean(customer.passwordHash),
    createdAt: customer.createdAt.toISOString(),
    lastLoginAt: iso(customer.lastLoginAt),
    counters: {
      orderCount: customer.orderCount,
      totalSpentPaise: customer.totalSpentPaise,
      firstOrderAt: iso(customer.firstOrderAt),
      lastOrderAt: iso(customer.lastOrderAt),
    },
    addresses: addresses.map(serializeIntegrationAddress),
  };
}

const PROFILE_SELECT = { ...CUSTOMER_CORE_SELECT, passwordHash: true } satisfies Prisma.CustomerSelect;

async function profileOf(tx: Tx | typeof db, id: string): Promise<IntegrationCustomer> {
  const [customer, addresses] = await Promise.all([
    tx.customer.findUniqueOrThrow({ where: { id }, select: PROFILE_SELECT }),
    tx.address.findMany({ where: { customerId: id }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], select: ADDRESS_SELECT }),
  ]);
  return serializeIntegrationCustomer(customer, addresses);
}

/** GET /integration/customers/:email */
export async function getIntegrationCustomer(email: string): Promise<IntegrationCustomer | null> {
  const customer = await findCustomerByEmail(db, email);
  return customer ? profileOf(db, customer.id) : null;
}

async function requireByEmail(tx: Tx, email: string): Promise<CustomerCore> {
  const customer = await findCustomerByEmail(tx, email);
  if (!customer) throw notFound("Customer");
  return customer;
}

// ---------------------------------------------------------------------------
// Upsert (welcome email on create)
// ---------------------------------------------------------------------------

export async function upsertCustomerFromIntegration(
  input: IntegrationUpsertInput,
  options: { ip?: string | null } = {},
): Promise<{ customer: IntegrationCustomer; created: boolean }> {
  const passwordHash = input.password ? await bcrypt.hash(input.password, BCRYPT_ROUNDS) : undefined;
  const email = normaliseEmail(input.email);

  return db.$transaction(async (tx) => {
    const existing = await findCustomerByEmail(tx, email);
    if (existing) {
      // Only fields the website actually sent change; a sync that omits the
      // phone must not erase it.
      await tx.customer.update({
        where: { id: existing.id },
        data: {
          ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
          ...(input.phone !== undefined ? { phone: normalisePhoneValue(input.phone) } : {}),
          ...(input.acceptsMarketing !== undefined ? { acceptsMarketing: input.acceptsMarketing } : {}),
          ...(input.emailVerifiedAt !== undefined ? { emailVerifiedAt: input.emailVerifiedAt } : {}),
          ...(passwordHash ? { passwordHash } : {}),
        },
      });
      return { customer: await profileOf(tx, existing.id), created: false };
    }

    const created = await tx.customer.create({
      data: {
        email,
        fullName: input.fullName ?? null,
        phone: normalisePhoneValue(input.phone),
        acceptsMarketing: input.acceptsMarketing ?? false,
        emailVerifiedAt: input.emailVerifiedAt ?? null,
        passwordHash: passwordHash ?? null,
      },
      select: { id: true, email: true, fullName: true },
    });
    await emitEvent("customer.created", { customerId: created.id, customerName: created.fullName ?? created.email, customerEmail: created.email }, tx);
    await writeAudit(tx, {
      actor: SYSTEM_ACTOR,
      action: "customer.create",
      entityType: "customer",
      entityId: created.id,
      entityLabel: created.email,
      summary: `Customer ${created.email} registered via the website.`,
      ip: options.ip ?? null,
      userAgent: null,
    });
    return { customer: await profileOf(tx, created.id), created: true };
  });
}

// ---------------------------------------------------------------------------
// Wishlist and cart lines (F4: variantId is required on the rows)
// ---------------------------------------------------------------------------

type ResolvedLine = { productId: string; variantId: string };

/**
 * Turn `{ productId, variantId? }` into a concrete variant. A missing
 * variantId means "the product's default" (isDefault, else the first active
 * one); a variantId that does not belong to the product is rejected rather
 * than silently swapped.
 */
async function resolveLine(tx: Tx, line: { productId: string; variantId?: string | null }): Promise<ResolvedLine | { error: string }> {
  const product = await tx.product.findFirst({ where: { id: line.productId, deletedAt: null }, select: { id: true } });
  if (!product) return { error: "Unknown product." };
  if (line.variantId) {
    const variant = await tx.productVariant.findFirst({ where: { id: line.variantId, productId: product.id, deletedAt: null }, select: { id: true } });
    return variant ? { productId: product.id, variantId: variant.id } : { error: "Variant does not belong to this product." };
  }
  const variant = await tx.productVariant.findFirst({
    where: { productId: product.id, deletedAt: null, isActive: true },
    orderBy: [{ isDefault: "desc" }, { position: "asc" }],
    select: { id: true },
  });
  return variant ? { productId: product.id, variantId: variant.id } : { error: "Product has no active variant." };
}

export type WishlistSyncResult = {
  items: Array<{ productId: string; variantId: string }>;
  skipped: Array<{ productId: string; variantId: string | null; reason: string }>;
};

/** PUT /integration/customers/:email/wishlist - full replace, idempotent. */
export async function replaceWishlist(email: string, input: IntegrationWishlistInput): Promise<WishlistSyncResult> {
  return db.$transaction(async (tx) => {
    const customer = await requireByEmail(tx, email);
    const wishlist = await tx.wishlist.upsert({ where: { customerId: customer.id }, update: {}, create: { customerId: customer.id }, select: { id: true } });

    const items: WishlistSyncResult["items"] = [];
    const skipped: WishlistSyncResult["skipped"] = [];
    const seen = new Set<string>();
    for (const line of input.items) {
      const resolved = await resolveLine(tx, line);
      if ("error" in resolved) {
        skipped.push({ productId: line.productId, variantId: line.variantId ?? null, reason: resolved.error });
        continue;
      }
      const key = `${resolved.productId}:${resolved.variantId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(resolved);
    }

    await tx.wishlistItem.deleteMany({ where: { wishlistId: wishlist.id } });
    if (items.length > 0) await tx.wishlistItem.createMany({ data: items.map((item) => ({ wishlistId: wishlist.id, ...item })) });
    return { items, skipped };
  });
}

export type CartSyncResult = {
  cartId: string;
  status: string;
  customerId: string | null;
  expiresAt: string | null;
  items: Array<{ productId: string; variantId: string; quantity: number }>;
  skipped: Array<{ productId: string; variantId: string | null; reason: string }>;
};

/** PUT /integration/carts/:sessionToken - upsert the cart and replace its lines. */
export async function upsertCart(sessionToken: string, input: IntegrationCartInput): Promise<CartSyncResult> {
  if (sessionToken.length < 8 || sessionToken.length > 256) throw badRequest("sessionToken must be 8-256 characters.");
  return db.$transaction(async (tx) => {
    const customer = input.email ? await findCustomerByEmail(tx, input.email) : null;
    const expiresAt = new Date(Date.now() + CART_TTL_DAYS * 24 * 60 * 60 * 1000);
    const cart = await tx.cart.upsert({
      where: { sessionToken },
      update: { status: "ACTIVE", expiresAt, customerId: customer?.id ?? undefined, ...(input.couponCode !== undefined ? { couponCode: input.couponCode } : {}) },
      create: { sessionToken, status: "ACTIVE", expiresAt, customerId: customer?.id ?? null, couponCode: input.couponCode ?? null },
      select: { id: true, status: true, customerId: true, expiresAt: true },
    });

    const merged = new Map<string, { productId: string; variantId: string; quantity: number; customization: unknown }>();
    const skipped: CartSyncResult["skipped"] = [];
    for (const line of input.items) {
      const resolved = await resolveLine(tx, line);
      if ("error" in resolved) {
        skipped.push({ productId: line.productId, variantId: line.variantId ?? null, reason: resolved.error });
        continue;
      }
      // Customised lines stay separate; identical plain lines merge.
      const key = line.customization === undefined ? `${resolved.variantId}` : `${resolved.variantId}:${JSON.stringify(line.customization)}`;
      const current = merged.get(key);
      if (current) current.quantity += line.quantity;
      else merged.set(key, { ...resolved, quantity: line.quantity, customization: line.customization });
    }

    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    const rows = [...merged.values()];
    if (rows.length > 0) {
      await tx.cartItem.createMany({
        data: rows.map((row) => ({
          cartId: cart.id,
          productId: row.productId,
          variantId: row.variantId,
          quantity: row.quantity,
          customization: row.customization === undefined ? undefined : (row.customization as Prisma.InputJsonValue),
        })),
      });
    }
    return {
      cartId: cart.id,
      status: cart.status,
      customerId: cart.customerId,
      expiresAt: iso(cart.expiresAt),
      items: rows.map(({ productId, variantId, quantity }) => ({ productId, variantId, quantity })),
      skipped,
    };
  });
}

// ---------------------------------------------------------------------------
// Sessions and credentials
// ---------------------------------------------------------------------------

/** POST /integration/customers/:email/login-event */
export async function recordLoginEvent(email: string, input: IntegrationLoginEventInput): Promise<{ customerId: string; lastLoginAt: string; sessionId: string }> {
  return db.$transaction(async (tx) => {
    const customer = await requireByEmail(tx, email);
    if (customer.status === "BLOCKED") throw badRequest("Customer is blocked.");
    const at = input.at ?? new Date();
    await tx.customer.update({ where: { id: customer.id }, data: { lastLoginAt: at } });

    // The website owns the session; we mirror it (hashed) so the admin can
    // list and revoke it. Without a token we still record the login against a
    // synthetic one. Upsert rather than create: the website may re-send a
    // login event for a session it already told us about (a "still signed in"
    // ping, a retried request), and `tokenHash` is unique - a plain create
    // would turn that into a 500.
    const tokenHash = hashToken(input.sessionToken ?? randomToken(32));
    const expiresAt = input.expiresAt ?? new Date(at.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    const session = await tx.customerSession.upsert({
      where: { tokenHash },
      update: { customerId: customer.id, ip: input.ip ?? null, userAgent: input.userAgent ?? null, expiresAt, revokedAt: null },
      create: {
        customerId: customer.id,
        tokenHash,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        expiresAt,
        createdAt: at,
      },
      select: { id: true },
    });
    return { customerId: customer.id, lastLoginAt: at.toISOString(), sessionId: session.id };
  });
}

export type VerifyCredentialsResult =
  | { ok: true; customer: { id: string; email: string; fullName: string | null } }
  | { ok: false; reason: "INVALID" | "BLOCKED" };

/**
 * POST /integration/customers/verify-credentials. One bcrypt compare happens
 * on every call, real hash or dummy, so timing does not reveal whether the
 * email exists. BLOCKED is only disclosed after the password matched.
 */
export async function verifyCustomerCredentials(email: string, password: string): Promise<VerifyCredentialsResult> {
  const customer = await db.customer.findFirst({
    where: { email: { equals: normaliseEmail(email), mode: "insensitive" }, deletedAt: null },
    select: { id: true, email: true, fullName: true, status: true, passwordHash: true },
  });
  const matched = await bcrypt.compare(password, customer?.passwordHash ?? (await dummyHash()));
  if (!customer || !customer.passwordHash || !matched) return { ok: false, reason: "INVALID" };
  if (customer.status === "BLOCKED") return { ok: false, reason: "BLOCKED" };
  return { ok: true, customer: { id: customer.id, email: customer.email, fullName: customer.fullName } };
}

/**
 * POST /integration/customers/reset-password. Single-use token, hashed at
 * rest (11.18); completing it revokes every session so a hijacked session
 * dies with the old password.
 */
export async function completeCustomerPasswordReset(token: string, newPassword: string): Promise<{ customerId: string; email: string }> {
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  return db.$transaction(async (tx) => {
    const row = await tx.customerPasswordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, customerId: true, expiresAt: true, usedAt: true, customer: { select: { id: true, email: true, deletedAt: true, status: true } } },
    });
    const now = new Date();
    if (!row || row.usedAt || row.expiresAt < now || row.customer.deletedAt || row.customer.status === "BLOCKED") {
      throw badRequest("This reset link is invalid or has expired.", { token: "Invalid or expired." });
    }
    await tx.customerPasswordResetToken.update({ where: { id: row.id }, data: { usedAt: now } });
    await tx.customerPasswordResetToken.deleteMany({ where: { customerId: row.customerId, usedAt: null } });
    // Completing a reset proves the customer controls the mailbox the link was
    // sent to, so the address is verified by the same act.
    await tx.customer.update({ where: { id: row.customerId }, data: { passwordHash, emailVerifiedAt: now } });
    await revokeCustomerSessions(tx, row.customerId, now);
    await writeAudit(tx, {
      actor: SYSTEM_ACTOR,
      action: "customer.password_reset_complete",
      entityType: "customer",
      entityId: row.customerId,
      entityLabel: row.customer.email,
      summary: `Customer ${row.customer.email} completed a password reset.`,
      ip: null,
      userAgent: null,
    });
    return { customerId: row.customerId, email: row.customer.email };
  });
}
