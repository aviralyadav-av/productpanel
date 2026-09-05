import { z } from "zod";

import { CUSTOMER_STATUSES, type CustomerStatus } from "@/lib/enums";

/**
 * The contract for the customers module: what the URL is allowed to say, what
 * the Server Actions accept, and the plain shapes the queries hand to the UI.
 *
 * The read shapes live here rather than in queries.ts so the detail sheet - a
 * Client Component - can import them without importing a module that is marked
 * `server-only`.
 */

// ---------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------

/** @/lib/enums ships the labels for customer status but no Zod schema. */
export const customerStatusSchema = z.enum(CUSTOMER_STATUSES);

export const CUSTOMER_SORTS = ["ltv", "orders", "joined"] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

export const CUSTOMER_SORT_LABELS: Record<CustomerSort, string> = {
  ltv: "lifetime value",
  orders: "orders",
  joined: "join date",
};

export const CUSTOMER_SEGMENTS = ["repeat", "new"] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

/**
 * Unknown values in the query string are ignored rather than rejected. A
 * hand-edited or stale URL should render the default list, not an error page.
 */
export function parseCustomerSort(raw: string | undefined): CustomerSort {
  return CUSTOMER_SORTS.includes(raw as CustomerSort)
    ? (raw as CustomerSort)
    : "ltv";
}

export function parseCustomerSegment(
  raw: string | undefined,
): CustomerSegment | undefined {
  return CUSTOMER_SEGMENTS.includes(raw as CustomerSegment)
    ? (raw as CustomerSegment)
    : undefined;
}

export function parseCustomerStatusFilter(
  raw: string | undefined,
): CustomerStatus | undefined {
  const parsed = customerStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

// ---------------------------------------------------------------------------
// Server Action inputs
// ---------------------------------------------------------------------------

const customerIdSchema = z.string().min(1, { message: "Missing customer id." });

export const setCustomerStatusSchema = z.object({
  id: customerIdSchema,
  status: customerStatusSchema,
});

export const updateCustomerNotesSchema = z.object({
  id: customerIdSchema,
  notes: z
    .string()
    .trim()
    .max(4000, { message: "Notes cannot be longer than 4000 characters." }),
});

export const updateCustomerProfileSchema = z.object({
  id: customerIdSchema,
  fullName: z
    .string()
    .trim()
    .max(120, { message: "Name cannot be longer than 120 characters." }),
  // Free text on purpose: this store takes Indian mobiles, landlines with STD
  // codes and the occasional "+91 " prefix, and rejecting any of those at the
  // form would make an operator unable to record what the customer actually
  // said on the phone.
  phone: z
    .string()
    .trim()
    .max(32, { message: "Phone number cannot be longer than 32 characters." }),
  // Trim and lower-case BEFORE the format check: z.email() rejects a padded
  // address outright, and an operator pasting from an order confirmation
  // should not have to notice a trailing space.
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ message: "Enter a valid email address." })),
});

export type SetCustomerStatusInput = z.input<typeof setCustomerStatusSchema>;
export type UpdateCustomerNotesInput = z.input<typeof updateCustomerNotesSchema>;
export type UpdateCustomerProfileInput = z.input<
  typeof updateCustomerProfileSchema
>;

// ---------------------------------------------------------------------------
// Read shapes
// ---------------------------------------------------------------------------

export type CustomerKpis = {
  total: number;
  /** Customers created inside the last 30 IST days. */
  newLast30: number;
  /** The same window immediately before it, so the KPI can show a delta. */
  newPrevious30: number;
  /** More than one order that was not cancelled. */
  repeat: number;
  withOrders: number;
  averageLifetimeValuePaise: number;
};

export type CustomerRow = {
  id: string;
  fullName: string | null;
  email: string;
  /** Masked in the list; the real number is only read in the detail sheet. */
  phoneMasked: string | null;
  status: string;
  orderCount: number;
  lifetimeValuePaise: number;
  averageOrderPaise: number;
  lastOrderAt: Date | null;
  createdAt: Date;
  hasAccount: boolean;
};

export type CustomerListResult = {
  rows: CustomerRow[];
  total: number;
};

export type CustomerAddressRow = {
  id: string;
  fullName: string;
  phone: string | null;
  line1: string;
  city: string;
  state: string;
  pinCode: string;
  country: string;
  isDefault: boolean;
};

export type CustomerOrderRow = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  totalPaise: number;
  refundedPaise: number;
  placedAt: Date;
  itemCount: number;
};

export type CustomerStats = {
  orderCount: number;
  cancelledCount: number;
  lifetimeValuePaise: number;
  refundedPaise: number;
  averageOrderPaise: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
};

export type CustomerDetail = {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  status: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Whether a User row is linked. Nothing else is read from User - that table
   * holds the password hash and has no business being on this screen.
   */
  hasAccount: boolean;
  addresses: CustomerAddressRow[];
  orders: CustomerOrderRow[];
  stats: CustomerStats;
};
