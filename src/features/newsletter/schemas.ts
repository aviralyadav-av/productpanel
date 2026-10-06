import { z } from "zod";

import { NEWSLETTER_STATUSES, newsletterStatusSchema, type NewsletterStatus } from "@/lib/enums";
import { one, type SearchParams } from "@/lib/list-params";
import { emailSchema, optionalTextSchema } from "@/lib/validation";
import type { ColumnDef } from "@/components/shared/column-visibility";

import { parseIstDayParam } from "@/features/reviews/schemas";

/**
 * Client-safe contracts for the newsletter module (blueprint §1 Newsletter,
 * §4.8, §14.D9, E3). The public subscribe endpoint, the admin dialogs and the
 * REST handlers all validate through these, so a rule can never be enforced
 * on one path and forgotten on another.
 */

export const looseIdSchema = z.string().trim().min(1, "Missing id.").max(64);

// ---------------------------------------------------------------------------
// List state (URL)
// ---------------------------------------------------------------------------

export const NEWSLETTER_SORTS = ["subscribedAt", "email", "name", "status", "source"] as const;
export type NewsletterSort = (typeof NEWSLETTER_SORTS)[number];

export function parseNewsletterSort(value: string | undefined): NewsletterSort {
  return (NEWSLETTER_SORTS as readonly string[]).includes(value ?? "") ? (value as NewsletterSort) : "subscribedAt";
}

export type NewsletterFilters = {
  q: string;
  status?: NewsletterStatus;
  source?: string;
  from?: Date;
  to?: Date;
};

export function parseNewsletterFilters(params: SearchParams): NewsletterFilters {
  const status = one(params, "status");
  return {
    q: (one(params, "q") ?? "").trim(),
    status: (NEWSLETTER_STATUSES as readonly string[]).includes(status ?? "") ? (status as NewsletterStatus) : undefined,
    source: one(params, "source"),
    from: parseIstDayParam(one(params, "from"), false),
    to: parseIstDayParam(one(params, "to"), true),
  };
}

export function hasNewsletterFilters(filters: NewsletterFilters): boolean {
  return Boolean(filters.q || filters.status || filters.source || filters.from || filters.to);
}

export const NEWSLETTER_COLUMNS: readonly ColumnDef[] = [
  { key: "email", label: "Email", locked: true },
  { key: "name", label: "Name" },
  { key: "status", label: "Status", locked: true },
  { key: "source", label: "Source" },
  { key: "subscribedAt", label: "Subscribed" },
  { key: "unsubscribedAt", label: "Unsubscribed" },
];

// ---------------------------------------------------------------------------
// Admin mutations
// ---------------------------------------------------------------------------

/** Where a subscriber came from; free text, but these are the ones we suggest. */
export const COMMON_SOURCES = ["admin", "import", "footer", "popup", "checkout", "storefront"] as const;

export const SOURCE_MAX = 40;

export const addSubscriberSchema = z.object({
  email: emailSchema,
  // `.optional().default(null)` rather than a bare optionalTextSchema so a REST
  // client may OMIT the key entirely, not only send an empty string.
  name: optionalTextSchema(120).optional().default(null),
  source: optionalTextSchema(SOURCE_MAX).optional().default(null),
  status: newsletterStatusSchema.default("SUBSCRIBED"),
});
export type AddSubscriberInput = z.input<typeof addSubscriberSchema>;
export type AddSubscriberValues = z.output<typeof addSubscriberSchema>;

export const updateSubscriberSchema = z.object({
  id: looseIdSchema,
  patch: z.object({
    name: optionalTextSchema(120).optional(),
    source: optionalTextSchema(SOURCE_MAX).optional(),
    status: newsletterStatusSchema.optional(),
  }),
});
export type UpdateSubscriberInput = z.input<typeof updateSubscriberSchema>;
export type UpdateSubscriberValues = z.output<typeof updateSubscriberSchema>["patch"];

export const setSubscriberStatusSchema = z.object({ id: looseIdSchema, status: newsletterStatusSchema });
export type SetSubscriberStatusInput = z.input<typeof setSubscriberStatusSchema>;

export const NEWSLETTER_BULK_OPS = ["unsubscribe", "resubscribe", "delete"] as const;
export type NewsletterBulkOp = (typeof NEWSLETTER_BULK_OPS)[number];
export const NEWSLETTER_BULK_MAX = 500;

export const bulkSubscribersSchema = z.object({
  ids: z.array(looseIdSchema).min(1, "Select at least one subscriber.").max(NEWSLETTER_BULK_MAX),
  op: z.enum(NEWSLETTER_BULK_OPS),
});
export type BulkSubscribersInput = z.input<typeof bulkSubscribersSchema>;

export const NEWSLETTER_BULK_PERMISSION: Record<NewsletterBulkOp, string> = {
  unsubscribe: "newsletter.manage",
  resubscribe: "newsletter.manage",
  delete: "newsletter.manage",
};

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_CSV_BYTES = 2 * 1024 * 1024;

export const importSubscribersSchema = z.object({
  csv: z.string().min(1, "Paste or upload a CSV first.").max(MAX_IMPORT_CSV_BYTES, "The file is too large (2 MB max)."),
  source: optionalTextSchema(SOURCE_MAX).optional(),
  /** false: only report what would happen. */
  apply: z.boolean().default(false),
});
export type ImportSubscribersInput = z.input<typeof importSubscribersSchema>;
export type ImportSubscribersValues = z.output<typeof importSubscribersSchema>;

// ---------------------------------------------------------------------------
// Public intake (POST /api/v1/newsletter/subscribe)
// ---------------------------------------------------------------------------

export const subscribeSchema = z.object({
  email: emailSchema,
  name: optionalTextSchema(120).optional(),
  source: optionalTextSchema(SOURCE_MAX).optional(),
  /** Honeypot: real forms leave it empty. */
  website: z.string().max(500).optional(),
});
export type SubscribeInput = z.input<typeof subscribeSchema>;
export type SubscribeValues = z.output<typeof subscribeSchema>;

export function isHoneypotTripped(values: { website?: string | null }): boolean {
  return typeof values.website === "string" && values.website.trim().length > 0;
}

/** The same answer for a new subscriber, a repeat subscriber and a bot. */
export const SUBSCRIBE_ACCEPTED_MESSAGE = "Thanks for subscribing! Look out for our next update.";

export const UNSUBSCRIBE_TOKEN_MAX = 200;
export const unsubscribeTokenSchema = z.string().trim().min(8).max(UNSUBSCRIBE_TOKEN_MAX);
