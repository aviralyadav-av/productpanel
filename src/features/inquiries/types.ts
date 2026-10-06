import type { InquiryPriority, InquiryStatus, InquiryType } from "@/lib/enums";
import type { PageMeta } from "@/lib/list-params";

/** Client-safe read models for the inquiries module. Dates are ISO strings. */

export type AssigneeRef = { id: string; name: string | null; email: string };

export type InquiryListRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string;
  type: InquiryType;
  priority: InquiryPriority;
  status: InquiryStatus;
  assignedTo: AssigneeRef | null;
  orderId: string | null;
  orderNumber: string | null;
  replyCount: number;
  lastReplyAt: string | null;
  createdAt: string;
};

export type InquiryListResult = { rows: InquiryListRow[]; meta: PageMeta };

export type InquiryStatusCounts = Record<InquiryStatus, number> & { all: number };

export type InquiryReplyRow = {
  id: string;
  message: string;
  isInternal: boolean;
  emailSent: boolean;
  author: string | null;
  createdAt: string;
};

export type InquiryActivityRow = {
  id: string;
  action: string;
  summary: string;
  actor: string;
  at: string;
};

export type InquiryDetail = InquiryListRow & {
  message: string;
  resolvedAt: string | null;
  updatedAt: string;
  order: { id: string; orderNumber: string; status: string; totalPaise: number } | null;
  customer: { id: string; name: string | null } | null;
  replies: InquiryReplyRow[];
  activity: InquiryActivityRow[];
};
