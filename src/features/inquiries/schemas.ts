import { z } from "zod";

import {
  INQUIRY_PRIORITIES,
  INQUIRY_STATUSES,
  INQUIRY_TYPES,
  inquiryPrioritySchema,
  inquiryStatusSchema,
  inquiryTypeSchema,
  type InquiryPriority,
  type InquiryStatus,
  type InquiryType,
} from "@/lib/enums";
import { one, type SearchParams } from "@/lib/list-params";
import { emailSchema, optionalTextSchema, phoneSchema, textSchema } from "@/lib/validation";
import type { ColumnDef } from "@/components/shared/column-visibility";

import { parseIstDayParam } from "@/features/reviews/schemas";

/**
 * Client-safe contracts for contact inquiries (blueprint §1 Inquiries, §4.8,
 * §14.D9, D12, E3). The public contact form and the admin console validate
 * through the same schemas.
 */

export const looseIdSchema = z.string().trim().min(1, "Missing id.").max(64);

// ---------------------------------------------------------------------------
// List state
// ---------------------------------------------------------------------------

export const INQUIRY_SORTS = ["createdAt", "name", "priority", "status", "lastReply"] as const;
export type InquirySort = (typeof INQUIRY_SORTS)[number];

export function parseInquirySort(value: string | undefined): InquirySort {
  return (INQUIRY_SORTS as readonly string[]).includes(value ?? "") ? (value as InquirySort) : "createdAt";
}

export type InquiryListFilters = {
  q: string;
  status?: InquiryStatus;
  type?: InquiryType;
  priority?: InquiryPriority;
  /** A user id, or "unassigned". */
  assignedTo?: string;
  from?: Date;
  to?: Date;
};

export function parseInquiryFilters(params: SearchParams): InquiryListFilters {
  const status = one(params, "status");
  const type = one(params, "type");
  const priority = one(params, "priority");
  return {
    q: (one(params, "q") ?? "").trim(),
    status: (INQUIRY_STATUSES as readonly string[]).includes(status ?? "") ? (status as InquiryStatus) : undefined,
    type: (INQUIRY_TYPES as readonly string[]).includes(type ?? "") ? (type as InquiryType) : undefined,
    priority: (INQUIRY_PRIORITIES as readonly string[]).includes(priority ?? "") ? (priority as InquiryPriority) : undefined,
    assignedTo: one(params, "assignedTo"),
    from: parseIstDayParam(one(params, "from"), false),
    to: parseIstDayParam(one(params, "to"), true),
  };
}

export function hasInquiryFilters(filters: InquiryListFilters): boolean {
  return Boolean(filters.q || filters.status || filters.type || filters.priority || filters.assignedTo || filters.from || filters.to);
}

export const INQUIRY_COLUMNS: readonly ColumnDef[] = [
  { key: "contact", label: "Contact", locked: true },
  { key: "subject", label: "Subject", locked: true },
  { key: "type", label: "Type" },
  { key: "priority", label: "Priority" },
  { key: "assigned", label: "Assigned" },
  { key: "status", label: "Status", locked: true },
  { key: "received", label: "Received" },
  { key: "lastReply", label: "Last reply" },
];

// ---------------------------------------------------------------------------
// Admin mutations
// ---------------------------------------------------------------------------

export const inquiryReplySchema = z.object({
  inquiryId: looseIdSchema,
  message: z.string().trim().min(1, "Write a message first.").max(10000, "Keep the message under 10,000 characters."),
});
export type InquiryReplyInput = z.input<typeof inquiryReplySchema>;

export const inquiryNoteSchema = inquiryReplySchema;
export type InquiryNoteInput = z.input<typeof inquiryNoteSchema>;

export const inquiryPatchSchema = z.object({
  type: inquiryTypeSchema.optional(),
  priority: inquiryPrioritySchema.optional(),
  subject: textSchema(200, "Subject").optional(),
});
export type InquiryPatchValues = z.output<typeof inquiryPatchSchema>;

export const updateInquirySchema = z.object({ id: looseIdSchema, patch: inquiryPatchSchema });
export type UpdateInquiryInput = z.input<typeof updateInquirySchema>;

export const assignInquirySchema = z.object({ id: looseIdSchema, assignedToId: looseIdSchema.nullable() });
export type AssignInquiryInput = z.input<typeof assignInquirySchema>;

export const setInquiryStatusSchema = z.object({ id: looseIdSchema, status: inquiryStatusSchema });
export type SetInquiryStatusInput = z.input<typeof setInquiryStatusSchema>;

export const INQUIRY_BULK_OPS = ["resolve", "spam", "assign", "reopen"] as const;
export type InquiryBulkOp = (typeof INQUIRY_BULK_OPS)[number];
export const INQUIRY_BULK_MAX = 500;

export const bulkInquirySchema = z
  .object({
    ids: z.array(looseIdSchema).min(1, "Select at least one inquiry.").max(INQUIRY_BULK_MAX),
    op: z.enum(INQUIRY_BULK_OPS),
    assignedToId: looseIdSchema.nullable().optional(),
  })
  .refine((value) => value.op !== "assign" || value.assignedToId !== undefined, {
    message: "Choose who to assign to.",
    path: ["assignedToId"],
  });
export type BulkInquiryInput = z.input<typeof bulkInquirySchema>;

/** Statuses an operator may set by hand (REPLIED is only ever set by replying). */
export const MANUAL_INQUIRY_STATUSES: readonly InquiryStatus[] = ["OPEN", "RESOLVED", "SPAM"];

// ---------------------------------------------------------------------------
// Public intake (POST /api/v1/contact)
// ---------------------------------------------------------------------------

export const contactSchema = z.object({
  name: textSchema(120, "Your name"),
  email: emailSchema,
  phone: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), phoneSchema.optional()),
  subject: textSchema(200, "Subject"),
  message: z.string().trim().min(10, "Please write at least 10 characters.").max(10000, "Keep the message under 10,000 characters."),
  type: inquiryTypeSchema.optional(),
  orderNumber: optionalTextSchema(32).optional(),
  /** Honeypot: real forms leave it empty. Non-empty submissions are silently dropped. */
  website: z.string().max(500).optional(),
});
export type ContactInput = z.input<typeof contactSchema>;
export type ContactValues = z.output<typeof contactSchema>;

export function isHoneypotTripped(values: { website?: string | null }): boolean {
  return typeof values.website === "string" && values.website.trim().length > 0;
}

export const CONTACT_ACCEPTED_MESSAGE = "Thanks for reaching out - we have received your message and will reply by email.";
