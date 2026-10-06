import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { INQUIRY_STATUSES, type InquiryPriority, type InquiryStatus, type InquiryType } from "@/lib/enums";
import { buildPageMeta, type ListParams } from "@/lib/list-params";

import type { InquiryListFilters, InquirySort } from "./schemas";
import type { AssigneeRef, InquiryDetail, InquiryListResult, InquiryListRow, InquiryStatusCounts } from "./types";

/** Read side of /admin/inquiries. */

const LIST_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  subject: true,
  type: true,
  priority: true,
  status: true,
  orderId: true,
  createdAt: true,
  assignedTo: { select: { id: true, name: true, email: true } },
  order: { select: { orderNumber: true } },
  replies: { where: { isInternal: false }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
  _count: { select: { replies: true } },
} satisfies Prisma.ContactInquirySelect;

type ListRow = Prisma.ContactInquiryGetPayload<{ select: typeof LIST_SELECT }>;

function toRow(row: ListRow): InquiryListRow {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    subject: row.subject,
    type: row.type as InquiryType,
    priority: row.priority as InquiryPriority,
    status: row.status as InquiryStatus,
    assignedTo: row.assignedTo,
    orderId: row.orderId,
    orderNumber: row.order?.orderNumber ?? null,
    replyCount: row._count.replies,
    lastReplyAt: row.replies[0]?.createdAt.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function buildInquiryWhere(filters: InquiryListFilters, options: { includeStatus?: boolean } = {}): Prisma.ContactInquiryWhereInput {
  const clauses: Prisma.ContactInquiryWhereInput[] = [];
  if ((options.includeStatus ?? true) && filters.status) clauses.push({ status: filters.status });
  if (filters.type) clauses.push({ type: filters.type });
  if (filters.priority) clauses.push({ priority: filters.priority });
  if (filters.assignedTo) clauses.push(filters.assignedTo === "unassigned" ? { assignedToId: null } : { assignedToId: filters.assignedTo });
  if (filters.from || filters.to) clauses.push({ createdAt: { gte: filters.from, lte: filters.to } });
  if (filters.q) {
    const q = filters.q;
    clauses.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { subject: { contains: q, mode: "insensitive" } },
        { message: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { order: { orderNumber: { equals: q.toUpperCase() } } },
        { id: q },
      ],
    });
  }
  return clauses.length > 0 ? { AND: clauses } : {};
}

/** Urgent first. `priority` is a String column, so alphabetical order (HIGH < LOW < NORMAL) is meaningless. */
const PRIORITY_ORDER: readonly InquiryPriority[] = ["HIGH", "NORMAL", "LOW"];

function orderBy(sort: InquirySort, order: "asc" | "desc"): Prisma.ContactInquiryOrderByWithRelationInput[] {
  switch (sort) {
    case "name":
      return [{ name: order }, { createdAt: "desc" }];
    case "status":
      return [{ status: order }, { createdAt: "desc" }];
    case "lastReply":
      // `updatedAt` is the proxy for "last touched": replying writes the status,
      // and a note on a NEW inquiry opens it. An internal note on an already
      // OPEN inquiry does not move it - deliberate, the column is about the
      // customer-facing conversation.
      return [{ updatedAt: order }, { createdAt: "desc" }];
    default:
      return [{ createdAt: order }, { id: order }];
  }
}

/**
 * Sorting by priority across the whole result set, not just the page.
 *
 * Sorting the fetched page in memory (the obvious shortcut) is wrong: page 2
 * of a HIGH-first list would still be whatever `createdAt` handed us. Instead
 * the three priorities are treated as three ordered buckets - one cheap
 * groupBy gives their sizes, and the requested window is sliced out of the one
 * or two buckets it actually overlaps.
 */
async function listInquiriesByPriority(
  params: ListParams,
  where: Prisma.ContactInquiryWhereInput,
  order: "asc" | "desc",
): Promise<ListRow[]> {
  const grouped = await db.contactInquiry.groupBy({ by: ["priority"], where, _count: { _all: true } });
  const sizes = new Map(grouped.map((row) => [row.priority, row._count._all]));
  const buckets = order === "asc" ? [...PRIORITY_ORDER].reverse() : PRIORITY_ORDER;

  const rows: ListRow[] = [];
  let cursor = 0; // rows of higher-priority buckets already passed
  let remaining = params.pageSize;

  for (const priority of buckets) {
    if (remaining <= 0) break;
    const size = sizes.get(priority) ?? 0;
    if (size === 0) continue;

    const localSkip = Math.max(0, params.skip - cursor);
    cursor += size;
    if (localSkip >= size) continue;

    const page = await db.contactInquiry.findMany({
      where: { AND: [where, { priority }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: localSkip,
      take: Math.min(remaining, size - localSkip),
      select: LIST_SELECT,
    });
    rows.push(...page);
    remaining -= page.length;
  }

  return rows;
}

export async function listInquiries(params: ListParams & { sort: InquirySort }, filters: InquiryListFilters): Promise<InquiryListResult> {
  const where = buildInquiryWhere(filters);
  const [total, rows] = await Promise.all([
    db.contactInquiry.count({ where }),
    params.sort === "priority"
      ? listInquiriesByPriority(params, where, params.order)
      : db.contactInquiry.findMany({ where, orderBy: orderBy(params.sort, params.order), skip: params.skip, take: params.pageSize, select: LIST_SELECT }),
  ]);
  return { rows: rows.map(toRow), meta: buildPageMeta(total, params) };
}

export async function inquiryStatusCounts(filters: InquiryListFilters): Promise<InquiryStatusCounts> {
  const grouped = await db.contactInquiry.groupBy({ by: ["status"], where: buildInquiryWhere(filters, { includeStatus: false }), _count: { _all: true } });
  const counts = Object.fromEntries(INQUIRY_STATUSES.map((status) => [status, 0])) as Record<InquiryStatus, number>;
  let all = 0;
  for (const row of grouped) {
    if ((INQUIRY_STATUSES as readonly string[]).includes(row.status)) counts[row.status as InquiryStatus] = row._count._all;
    all += row._count._all;
  }
  return { ...counts, all };
}

/** Active admin users an inquiry can be assigned to (the system actor excluded). */
export async function listAssignableUsers(): Promise<AssigneeRef[]> {
  return db.user.findMany({
    where: { isActive: true, deletedAt: null, id: { not: "system" } },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    select: { id: true, name: true, email: true },
  });
}

export async function getInquiryDetail(id: string): Promise<InquiryDetail | null> {
  const row = await db.contactInquiry.findUnique({
    where: { id },
    select: {
      ...LIST_SELECT,
      message: true,
      resolvedAt: true,
      updatedAt: true,
      order: { select: { id: true, orderNumber: true, status: true, totalPaise: true } },
      replies: { orderBy: { createdAt: "asc" }, select: { id: true, message: true, isInternal: true, emailSent: true, createdAt: true, author: { select: { name: true, email: true } } } },
    },
  });
  if (!row) return null;

  const [customer, audits] = await Promise.all([
    db.customer.findFirst({ where: { email: row.email, deletedAt: null }, select: { id: true, fullName: true } }),
    db.auditLog.findMany({
      where: { entityType: "ContactInquiry", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, action: true, summary: true, actorEmail: true, createdAt: true, actor: { select: { name: true } } },
    }),
  ]);

  const publicReplies = row.replies.filter((reply) => !reply.isInternal);
  return {
    ...toRow({ ...row, replies: publicReplies.slice(-1).map((reply) => ({ createdAt: reply.createdAt })) }),
    message: row.message,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    order: row.order,
    customer: customer ? { id: customer.id, name: customer.fullName } : null,
    replies: row.replies.map((reply) => ({
      id: reply.id,
      message: reply.message,
      isInternal: reply.isInternal,
      emailSent: reply.emailSent,
      author: reply.author?.name ?? reply.author?.email ?? null,
      createdAt: reply.createdAt.toISOString(),
    })),
    activity: audits.map((audit) => ({
      id: audit.id,
      action: audit.action,
      summary: audit.summary,
      actor: audit.actor?.name ?? audit.actorEmail,
      at: audit.createdAt.toISOString(),
    })),
  };
}
