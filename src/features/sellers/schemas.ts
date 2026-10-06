import { z } from "zod";

import {
  LEDGER_ENTRY_STATUSES,
  LEDGER_ENTRY_TYPES,
  SELLER_DOCUMENT_TYPES,
  SELLER_STATUSES,
  SELLER_TRANSITIONS,
  ledgerEntryStatusSchema,
  ledgerEntryTypeSchema,
  sellerDocumentTypeSchema,
  sellerStatusSchema,
  type LedgerEntryStatus,
  type LedgerEntryType,
  type SellerStatus,
} from "@/lib/enums";
import { many, one, type SearchParams } from "@/lib/list-params";
import {
  bpsSchema,
  emailSchema,
  paiseSchema,
  phoneSchema,
  pincodeSchema,
  slugSchema,
  textSchema,
} from "@/lib/validation";

/**
 * The sellers module contract (blueprint §4.4, §14.C5-C7, D4, D11): what the
 * URL may say, what every Server Action and REST body must look like, and
 * the Indian tax-id formats a seller profile has to satisfy.
 *
 * No Next imports - the public intake route, the node:test file and the
 * check script validate with these too.
 */

export { SELLER_STATUSES, SELLER_DOCUMENT_TYPES, sellerStatusSchema, sellerDocumentTypeSchema };
export type { SellerStatus };

// ---------------------------------------------------------------------------
// Indian tax / banking identifiers
// ---------------------------------------------------------------------------

/** 15 chars: 2-digit state code, 10-char PAN, entity digit, "Z", check char. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
/** 10 chars: 5 letters, 4 digits, 1 letter. The 4th letter is the holder type. */
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
/** 11 chars: 4-letter bank code, "0", 6-char branch code. */
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
/** VPA: handle@psp. */
export const UPI_PATTERN = /^[a-zA-Z0-9.\-_]{2,100}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;

export function isValidGstin(value: string): boolean {
  return GSTIN_PATTERN.test(value.trim().toUpperCase());
}

export function isValidPan(value: string): boolean {
  return PAN_PATTERN.test(value.trim().toUpperCase());
}

/**
 * The PAN embedded in a GSTIN (characters 3-12) must match the seller's PAN
 * when both are given; a mismatch is the most common data-entry error.
 */
export function gstinMatchesPan(gstin: string, pan: string): boolean {
  return gstin.trim().toUpperCase().slice(2, 12) === pan.trim().toUpperCase();
}

function upperOrNull(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim().toUpperCase();
  return trimmed === "" ? null : trimmed;
}

export const gstinSchema = z.preprocess(
  upperOrNull,
  z.string().regex(GSTIN_PATTERN, "Enter a valid 15-character GSTIN.").nullable(),
);

export const panSchema = z.preprocess(
  upperOrNull,
  z.string().regex(PAN_PATTERN, "Enter a valid 10-character PAN.").nullable(),
);

export const ifscSchema = z.preprocess(
  upperOrNull,
  z.string().regex(IFSC_PATTERN, "Enter a valid 11-character IFSC code."),
);

export const upiIdSchema = z.preprocess(
  (value) => (value === undefined || (typeof value === "string" && value.trim() === "") ? null : value),
  z.string().trim().regex(UPI_PATTERN, "Enter a valid UPI id like name@bank.").nullable(),
);

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Optional text for API bodies: a MISSING key, "" and null all become null.
 * (`optionalTextSchema` from src/lib/validation requires the key to be present,
 * which suits forms but not JSON callers that omit what they do not know.)
 */
export function optionalText(max: number) {
  return z.preprocess(
    (value) => (value === undefined || (typeof value === "string" && value.trim() === "") ? null : value),
    z.string().trim().max(max).nullable(),
  );
}

/** Same rule for other optional scalars: undefined/"" -> null, otherwise validate. */
function blankToNull(value: unknown): unknown {
  return value === undefined || (typeof value === "string" && value.trim() === "") ? null : value;
}

/** Ids are opaque: the demo seed uses readable ids ("demo_seller_001"). */
export const looseIdSchema = z
  .string()
  .trim()
  .min(1, "Missing id.")
  .max(64, "Invalid id.")
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid id.");

export const nullableIdSchema = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  looseIdSchema.nullable(),
);

/** "" -> null, otherwise the normalised phone. */
export const optionalPhoneSchema = z.preprocess(blankToNull, phoneSchema.nullable());

export const optionalPincodeSchema = z.preprocess(blankToNull, pincodeSchema.nullable());

export const nullableBpsSchema = z.preprocess(
  (value) => (value === "" || value === undefined || value === null ? null : value),
  bpsSchema.nullable(),
);

// ---------------------------------------------------------------------------
// Seller profile (admin create / edit)
// ---------------------------------------------------------------------------

export const sellerProfileSchema = z
  .object({
    displayName: textSchema(120, "Display name"),
    slug: slugSchema,
    legalName: optionalText(200),
    ownerName: textSchema(120, "Owner name"),
    email: emailSchema,
    phone: optionalPhoneSchema,
    description: optionalText(5000),
    addressLine1: optionalText(200),
    addressLine2: optionalText(200),
    city: optionalText(80),
    state: optionalText(80),
    pinCode: optionalPincodeSchema,
    country: z.string().trim().length(2, "Use a 2-letter country code.").toUpperCase().default("IN"),
    gstin: gstinSchema,
    pan: panSchema,
    logoMediaId: nullableIdSchema,
    bannerMediaId: nullableIdSchema,
  })
  .superRefine((value, ctx) => {
    if (value.gstin && value.pan && !gstinMatchesPan(value.gstin, value.pan)) {
      ctx.addIssue({
        code: "custom",
        path: ["gstin"],
        message: "The PAN inside this GSTIN (characters 3-12) does not match the PAN entered.",
      });
    }
  });

export type SellerProfileInput = z.input<typeof sellerProfileSchema>;
export type SellerProfileValues = z.output<typeof sellerProfileSchema>;

export const INITIAL_SELLER_STATUSES = ["PENDING", "ACTIVE"] as const;
export type InitialSellerStatus = (typeof INITIAL_SELLER_STATUSES)[number];

export const createSellerSchema = z.object({
  profile: sellerProfileSchema,
  initialStatus: z.enum(INITIAL_SELLER_STATUSES).default("PENDING"),
  /** Optional SELLER-scope commission override, in basis points. */
  commissionBps: nullableBpsSchema,
});
export type CreateSellerInput = z.input<typeof createSellerSchema>;
export type CreateSellerValues = z.output<typeof createSellerSchema>;

export const updateSellerSchema = z.object({
  id: looseIdSchema,
  profile: sellerProfileSchema,
});
export type UpdateSellerInput = z.input<typeof updateSellerSchema>;

// ---------------------------------------------------------------------------
// Workflow (C5)
// ---------------------------------------------------------------------------

/** Targets an operator may request; PENDING is only ever the starting state. */
export const TRANSITION_TARGETS = ["UNDER_REVIEW", "APPROVED", "ACTIVE", "SUSPENDED", "REJECTED"] as const;
export type TransitionTarget = (typeof TRANSITION_TARGETS)[number];

/** States whose entry requires a written reason (C5). */
export const REASON_REQUIRED_STATUSES: readonly SellerStatus[] = ["REJECTED", "SUSPENDED"];

export function transitionNeedsReason(toStatus: SellerStatus): boolean {
  return REASON_REQUIRED_STATUSES.includes(toStatus);
}

/**
 * Which permission a transition needs: suspending and reinstating are
 * `sellers.suspend`; review, approval, rejection and first activation are
 * `sellers.approve`.
 */
export function permissionForTransition(from: SellerStatus, to: SellerStatus): string {
  if (to === "SUSPENDED" || (from === "SUSPENDED" && to === "ACTIVE")) return "sellers.suspend";
  return "sellers.approve";
}

/** Operator-facing verb for a transition button. */
export function transitionLabel(from: SellerStatus, to: SellerStatus): string {
  switch (to) {
    case "UNDER_REVIEW":
      return from === "REJECTED" ? "Re-review" : "Move to review";
    case "APPROVED":
      return "Approve";
    case "ACTIVE":
      return from === "SUSPENDED" ? "Reinstate" : "Activate";
    case "SUSPENDED":
      return "Suspend";
    case "REJECTED":
      return "Reject";
    default:
      return to;
  }
}

/** The legal next states for a seller, straight from the enums map. */
export function nextSellerStatuses(from: SellerStatus): readonly SellerStatus[] {
  return SELLER_TRANSITIONS[from] ?? [];
}

/**
 * The transition body without the seller id, and the same shape with it.
 *
 * Both are built from one unrefined object because Zod 4 refuses `.omit()` on a
 * schema that already carries a refinement - deriving the route body from the
 * refined schema throws at module load, which only a production build catches.
 */
const transitionSellerFields = z.object({
  toStatus: sellerStatusSchema,
  reason: optionalText(1000),
  /**
   * With APPROVED: also move to ACTIVE in the same transaction when the
   * activation conditions hold ("Approve & activate"). Ignored otherwise.
   */
  activate: z.boolean().optional(),
});

function requireTransitionReason(
  value: { toStatus: SellerStatus; reason?: string | null },
  ctx: z.RefinementCtx,
) {
  if (transitionNeedsReason(value.toStatus) && !value.reason) {
    ctx.addIssue({ code: "custom", path: ["reason"], message: "A reason is required for this change." });
  }
}

/** PUT /api/admin/sellers/:id/status - the id comes from the path. */
export const transitionSellerBodySchema = transitionSellerFields.superRefine(requireTransitionReason);
export type TransitionSellerBodyInput = z.input<typeof transitionSellerBodySchema>;

export const transitionSellerSchema = transitionSellerFields
  .extend({ id: looseIdSchema })
  .superRefine(requireTransitionReason);
export type TransitionSellerInput = z.input<typeof transitionSellerSchema>;

export const BULK_SELLER_STATUSES = ["UNDER_REVIEW", "APPROVED", "REJECTED", "SUSPENDED", "ACTIVE"] as const;
export type BulkSellerStatus = (typeof BULK_SELLER_STATUSES)[number];

export const bulkSellerStatusSchema = z
  .object({
    ids: z.array(looseIdSchema).min(1, "Select at least one seller.").max(500, "At most 500 sellers per bulk action."),
    toStatus: z.enum(BULK_SELLER_STATUSES),
    reason: optionalText(1000),
  })
  .superRefine((value, ctx) => {
    if (transitionNeedsReason(value.toStatus) && !value.reason) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "A reason is required for this change." });
    }
  });
export type BulkSellerStatusInput = z.input<typeof bulkSellerStatusSchema>;

// ---------------------------------------------------------------------------
// Documents (KYC)
// ---------------------------------------------------------------------------

export const SELLER_DOCUMENT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const SELLER_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

export const documentMetaSchema = z.object({
  type: sellerDocumentTypeSchema,
  label: optionalText(120),
});
export type DocumentMetaInput = z.input<typeof documentMetaSchema>;

export const DOCUMENT_REVIEW_STATUSES = ["VERIFIED", "REJECTED"] as const;

const reviewDocumentFields = z.object({
  status: z.enum(DOCUMENT_REVIEW_STATUSES),
  note: optionalText(1000),
});

function requireRejectionNote(
  value: { status: (typeof DOCUMENT_REVIEW_STATUSES)[number]; note?: string | null },
  ctx: z.RefinementCtx,
) {
  if (value.status === "REJECTED" && !value.note) {
    ctx.addIssue({ code: "custom", path: ["note"], message: "Say what is wrong with the document." });
  }
}

/** PUT /api/admin/sellers/:id/documents/:docId - both ids come from the path. */
export const reviewDocumentBodySchema = reviewDocumentFields.superRefine(requireRejectionNote);
export type ReviewDocumentBodyInput = z.input<typeof reviewDocumentBodySchema>;

export const reviewDocumentSchema = reviewDocumentFields
  .extend({ sellerId: looseIdSchema, documentId: looseIdSchema })
  .superRefine(requireRejectionNote);
export type ReviewDocumentInput = z.input<typeof reviewDocumentSchema>;

// ---------------------------------------------------------------------------
// Bank accounts (D4)
// ---------------------------------------------------------------------------

export const accountNumberSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{6,20}$/, "Account numbers are 6-20 digits.");

export const bankAccountSchema = z.object({
  accountHolder: textSchema(120, "Account holder"),
  bankName: textSchema(120, "Bank name"),
  accountNumber: accountNumberSchema,
  ifsc: ifscSchema,
  upiId: upiIdSchema,
  isPrimary: z.boolean().default(false),
});
export type BankAccountInput = z.input<typeof bankAccountSchema>;
export type BankAccountValues = z.output<typeof bankAccountSchema>;

/** Edits leave the number alone unless a new one is typed. */
export const bankAccountUpdateSchema = z.object({
  accountHolder: textSchema(120, "Account holder"),
  bankName: textSchema(120, "Bank name"),
  accountNumber: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    accountNumberSchema.optional(),
  ),
  ifsc: ifscSchema,
  upiId: upiIdSchema,
});
export type BankAccountUpdateInput = z.input<typeof bankAccountUpdateSchema>;
export type BankAccountUpdateValues = z.output<typeof bankAccountUpdateSchema>;

// ---------------------------------------------------------------------------
// Commission override (B3)
// ---------------------------------------------------------------------------

export const commissionOverrideSchema = z.object({
  rateBps: bpsSchema,
  fixedPaise: paiseSchema.default(0),
  note: optionalText(300),
});
export type CommissionOverrideInput = z.input<typeof commissionOverrideSchema>;
export type CommissionOverrideValues = z.output<typeof commissionOverrideSchema>;

// ---------------------------------------------------------------------------
// Public registration intake (C6)
// ---------------------------------------------------------------------------

export const REGISTRATION_PASSWORD_MIN = 8;

export const registerDocumentSchema = z.object({
  type: sellerDocumentTypeSchema,
  uploadToken: z.string().trim().min(16, "Invalid upload token.").max(200, "Invalid upload token."),
  label: optionalText(120),
});

export const registerSellerSchema = z
  .object({
    ownerName: textSchema(120, "Owner name"),
    displayName: textSchema(120, "Shop name"),
    legalName: optionalText(200),
    email: emailSchema,
    phone: phoneSchema,
    password: z
      .preprocess(
        (value) => (typeof value === "string" && value === "" ? undefined : value),
        z
          .string()
          .min(REGISTRATION_PASSWORD_MIN, `Password must be at least ${REGISTRATION_PASSWORD_MIN} characters.`)
          .max(200, "Password is too long.")
          .optional(),
      ),
    addressLine1: textSchema(200, "Address"),
    addressLine2: optionalText(200),
    city: textSchema(80, "City"),
    state: textSchema(80, "State"),
    pinCode: pincodeSchema,
    gstin: gstinSchema.optional(),
    pan: panSchema.optional(),
    description: optionalText(5000),
    documents: z.array(registerDocumentSchema).max(10, "At most 10 documents.").default([]),
  })
  .superRefine((value, ctx) => {
    if (value.gstin && value.pan && !gstinMatchesPan(value.gstin, value.pan)) {
      ctx.addIssue({ code: "custom", path: ["gstin"], message: "GSTIN and PAN do not match." });
    }
  });
export type RegisterSellerInput = z.input<typeof registerSellerSchema>;
export type RegisterSellerValues = z.output<typeof registerSellerSchema>;

// ---------------------------------------------------------------------------
// List URL state
// ---------------------------------------------------------------------------

export const SELLER_SORTS = ["name", "registered", "products", "orders", "grossSales", "rating", "status"] as const;
export type SellerSort = (typeof SELLER_SORTS)[number];

export function parseSellerSort(raw: string | undefined): SellerSort {
  return (SELLER_SORTS as readonly string[]).includes(raw ?? "") ? (raw as SellerSort) : "registered";
}

export function parseSellerStatus(raw: string | undefined): SellerStatus | undefined {
  const parsed = sellerStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export type SellerListFilters = {
  q: string;
  status?: SellerStatus;
  state?: string;
  city?: string;
  /** Only sellers with at least one PENDING document. */
  pendingDocs: boolean;
  /** ratingAvg >= minRating (1-5). */
  minRating?: number;
};

export function parseSellerFilters(params: SearchParams): SellerListFilters {
  const minRatingRaw = Number(one(params, "minRating"));
  const minRating = Number.isFinite(minRatingRaw) && minRatingRaw >= 1 && minRatingRaw <= 5 ? minRatingRaw : undefined;
  const pendingDocsRaw = one(params, "pendingDocs");
  return {
    q: (one(params, "q") ?? "").trim().slice(0, 120),
    status: parseSellerStatus(one(params, "status")),
    state: one(params, "state")?.slice(0, 80),
    city: one(params, "city")?.slice(0, 80),
    pendingDocs: pendingDocsRaw === "1" || pendingDocsRaw === "true",
    minRating,
  };
}

export function hasSellerFilters(filters: SellerListFilters): boolean {
  return Boolean(
    filters.q || filters.status || filters.state || filters.city || filters.pendingDocs || filters.minRating !== undefined,
  );
}

/** Column definitions for ColumnVisibilityMenu (tableKey "sellers"). */
export const SELLER_COLUMNS = [
  { key: "seller", label: "Seller", locked: true },
  { key: "business", label: "Business" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone", defaultHidden: true },
  { key: "location", label: "Location" },
  { key: "registered", label: "Registered" },
  { key: "status", label: "Status", locked: true },
  { key: "products", label: "Products" },
  { key: "orders", label: "Orders" },
  { key: "revenue", label: "Revenue" },
  { key: "rating", label: "Rating" },
  { key: "commission", label: "Commission" },
  { key: "payout", label: "Payout" },
] as const;

// ---------------------------------------------------------------------------
// Detail tabs + earnings filters
// ---------------------------------------------------------------------------

export const SELLER_TABS = [
  "overview",
  "profile",
  "documents",
  "bank",
  "commission",
  "products",
  "orders",
  "earnings",
  "reviews",
  "performance",
  "activity",
] as const;
export type SellerTab = (typeof SELLER_TABS)[number];

export const SELLER_TAB_LABELS: Record<SellerTab, string> = {
  overview: "Overview",
  profile: "Profile & business",
  documents: "Documents",
  bank: "Bank accounts",
  commission: "Commission",
  products: "Products",
  orders: "Orders",
  earnings: "Earnings",
  reviews: "Reviews",
  performance: "Performance",
  activity: "Activity",
};

export function parseSellerTab(raw: string | undefined): SellerTab {
  return (SELLER_TABS as readonly string[]).includes(raw ?? "") ? (raw as SellerTab) : "overview";
}

export function parseLedgerType(raw: string | undefined): LedgerEntryType | undefined {
  const parsed = ledgerEntryTypeSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export function parseLedgerStatus(raw: string | undefined): LedgerEntryStatus | undefined {
  const parsed = ledgerEntryStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export { LEDGER_ENTRY_TYPES, LEDGER_ENTRY_STATUSES };

/** `?ids=a&ids=b` or a comma list, capped to the bulk limit. */
export function parseIdList(params: SearchParams, key = "ids"): string[] {
  return [...new Set(many(params, key).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean))].slice(0, 500);
}

/** Show the first two and last three characters of a GSTIN in lists (D11-adjacent: tax ids are PII). */
export function maskGstin(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  if (gstin.length <= 5) return "•".repeat(gstin.length);
  return `${gstin.slice(0, 2)}${"•".repeat(gstin.length - 5)}${gstin.slice(-3)}`;
}

export function maskPan(pan: string | null | undefined): string | null {
  if (!pan) return null;
  if (pan.length <= 4) return "•".repeat(pan.length);
  return `${"•".repeat(pan.length - 4)}${pan.slice(-4)}`;
}
