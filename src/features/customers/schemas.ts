import { z } from "zod";

import { ADDRESS_TYPES, CUSTOMER_STATUSES, customerStatusSchema } from "@/lib/enums";
import { emailSchema, idSchema, optionalTextSchema, phoneSchema, pincodeSchema, quantitySchema, textSchema } from "@/lib/validation";

/**
 * Zod schemas for the customers module - forms, Server Actions, admin REST
 * and the website integration API all parse through these. Client-safe: no
 * database or Next imports.
 *
 * zod v4 note: `.partial()` must be taken from the UNREFINED object (a
 * refined schema throws at import time), so every patch schema below derives
 * from the plain object.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** "" / null -> null, otherwise a normalised phone number (validation.ts). */
export const optionalPhoneSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  phoneSchema.nullable(),
);

export const tagsSchema = z.array(z.string().trim().min(1).max(40)).max(20).default([]);

/** Any id-like string: demo/seed ids are not cuids, so the strict cuid check is too narrow. */
export const looseIdSchema = z.string().trim().min(1).max(64);

/** Customer passwords: a shorter floor than admin accounts (E7 delegated storage). */
export const customerPasswordSchema = z.string().min(8, "Use at least 8 characters.").max(128, "Password is too long.");

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export const addressSchema = z.object({
  label: optionalTextSchema(60),
  fullName: textSchema(120, "Name"),
  phone: optionalPhoneSchema,
  line1: textSchema(200, "Address line 1"),
  line2: optionalTextSchema(200),
  landmark: optionalTextSchema(120),
  city: textSchema(80, "City"),
  state: textSchema(80, "State"),
  pinCode: pincodeSchema,
  country: z.string().trim().length(2, "Use a 2-letter country code.").toUpperCase().default("IN"),
  type: z.enum(ADDRESS_TYPES).default("BOTH"),
  isDefault: z.boolean().default(false),
});
export type AddressInput = z.input<typeof addressSchema>;
export type AddressValues = z.output<typeof addressSchema>;

// ---------------------------------------------------------------------------
// Customer form (admin create / profile edit)
// ---------------------------------------------------------------------------

const customerFormObject = z.object({
  fullName: optionalTextSchema(120),
  email: emailSchema,
  phone: optionalPhoneSchema,
  acceptsMarketing: z.boolean().default(false),
  tags: tagsSchema,
  notes: optionalTextSchema(5000),
});

export const customerFormSchema = customerFormObject.extend({
  /** Only on create: the first address in the book, saved as default. */
  address: addressSchema.nullable().optional(),
});
export type CustomerFormInput = z.input<typeof customerFormSchema>;
export type CustomerFormValues = z.output<typeof customerFormSchema>;

export const customerPatchSchema = customerFormObject.partial();
export type CustomerPatch = z.output<typeof customerPatchSchema>;

// ---------------------------------------------------------------------------
// Status, bulk, delete
// ---------------------------------------------------------------------------

export const setStatusSchema = z.object({
  status: customerStatusSchema,
  /** Recorded in the audit row (D13); the UI requires one when blocking. */
  reason: optionalTextSchema(500).optional(),
});
export type SetStatusInput = z.input<typeof setStatusSchema>;

export const BULK_OPERATIONS = ["BLOCK", "UNBLOCK", "ADD_TAG", "REMOVE_TAG"] as const;
export type BulkOperation = (typeof BULK_OPERATIONS)[number];
export const BULK_MAX_IDS = 500;

export const BULK_OP_PERMISSION: Record<BulkOperation, string> = {
  BLOCK: "customers.block",
  UNBLOCK: "customers.block",
  ADD_TAG: "customers.edit",
  REMOVE_TAG: "customers.edit",
};

export const BULK_OP_LABELS: Record<BulkOperation, string> = {
  BLOCK: "Block",
  UNBLOCK: "Unblock",
  ADD_TAG: "Add tag",
  REMOVE_TAG: "Remove tag",
};

export const bulkRequestSchema = z
  .object({
    ids: z.array(looseIdSchema).min(1, "Select at least one customer.").max(BULK_MAX_IDS, `At most ${BULK_MAX_IDS} customers per bulk action.`),
    op: z.enum(BULK_OPERATIONS),
    tag: z.string().trim().min(1).max(40).optional(),
    reason: optionalTextSchema(500).optional(),
  })
  .refine((value) => (value.op === "ADD_TAG" || value.op === "REMOVE_TAG" ? Boolean(value.tag) : true), {
    message: "A tag is required.",
    path: ["tag"],
  });
export type BulkRequest = z.output<typeof bulkRequestSchema>;

export const deleteCustomerSchema = z.object({ reason: optionalTextSchema(500).optional() });

// ---------------------------------------------------------------------------
// Website integration (E7)
// ---------------------------------------------------------------------------

export const integrationUpsertSchema = z.object({
  email: emailSchema,
  fullName: optionalTextSchema(120).optional(),
  phone: optionalPhoneSchema.optional(),
  acceptsMarketing: z.boolean().optional(),
  emailVerifiedAt: z.coerce.date().nullable().optional(),
  /** Plaintext; bcrypt-hashed before it touches the database. */
  password: customerPasswordSchema.optional(),
});
export type IntegrationUpsertInput = z.output<typeof integrationUpsertSchema>;

export const integrationLineSchema = z.object({
  productId: looseIdSchema,
  variantId: looseIdSchema.nullable().optional(),
});

export const integrationWishlistSchema = z.object({
  items: z.array(integrationLineSchema).max(200),
});
export type IntegrationWishlistInput = z.output<typeof integrationWishlistSchema>;

export const integrationCartSchema = z.object({
  email: emailSchema.nullable().optional(),
  couponCode: optionalTextSchema(40).optional(),
  items: z
    .array(
      integrationLineSchema.extend({
        quantity: quantitySchema.min(1, "Quantity must be at least 1."),
        customization: z.unknown().optional(),
      }),
    )
    .max(100),
});
export type IntegrationCartInput = z.output<typeof integrationCartSchema>;

export const integrationLoginEventSchema = z.object({
  at: z.coerce.date().optional(),
  ip: z.string().trim().max(64).nullable().optional(),
  userAgent: z.string().trim().max(512).nullable().optional(),
  /** The website's own session token, when it wants the session mirrored here. */
  sessionToken: z.string().trim().min(16).max(512).optional(),
  expiresAt: z.coerce.date().optional(),
});
export type IntegrationLoginEventInput = z.output<typeof integrationLoginEventSchema>;

export const integrationVerifyCredentialsSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const integrationResetPasswordSchema = z.object({
  token: z.string().trim().min(16).max(256),
  newPassword: customerPasswordSchema,
});

/** `?status=` on the list: the two real statuses plus the soft-deleted bucket. */
export const LIST_STATUS_FILTERS = [...CUSTOMER_STATUSES, "DELETED"] as const;
export type ListStatusFilter = (typeof LIST_STATUS_FILTERS)[number];

export { idSchema };
