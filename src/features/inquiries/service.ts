import type { Prisma } from "@prisma/client";

import { badRequest, notFound } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { db } from "@/lib/db";
import { INQUIRY_STATUS_META, type InquiryStatus } from "@/lib/enums";
import { sanitizeHtml, stripHtml } from "@/lib/sanitize/html";
import { commonEmailVars, queueRawEmail } from "@/features/email/service";
import { escapeHtml, htmlToText } from "@/features/email/render";
import { emitEvent } from "@/features/notifications/service";

import { CONTACT_ACCEPTED_MESSAGE, isHoneypotTripped, type BulkInquiryInput, type ContactValues, type InquiryPatchValues } from "./schemas";

/**
 * Business rules for contact inquiries (blueprint §1 Inquiries, §4.8, E3).
 * No `server-only` / `next/*` imports; the actions and REST handlers wrap
 * these. Replies to the customer go through the email outbox (queueRawEmail)
 * so a broken SMTP setting never loses the reply text - it is stored on the
 * InquiryReply row first and `emailSent` records whether the mail was queued.
 */

type Db = Prisma.TransactionClient;
export type InquiryActor = AuditActor & { name?: string | null };
type ClientInfo = { ip?: string | null };

const INQUIRY_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  subject: true,
  message: true,
  type: true,
  orderId: true,
  status: true,
  priority: true,
  assignedToId: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ContactInquirySelect;

export type InquiryRecord = Prisma.ContactInquiryGetPayload<{ select: typeof INQUIRY_SELECT }>;

function actorId(actor: InquiryActor): string | null {
  return actor.id === "system" ? null : actor.id;
}

async function requireInquiry(tx: Db, id: string): Promise<InquiryRecord> {
  const inquiry = await tx.contactInquiry.findUnique({ where: { id }, select: INQUIRY_SELECT });
  if (!inquiry) throw notFound("Inquiry");
  return inquiry;
}

// ---------------------------------------------------------------------------
// Public intake (POST /api/v1/contact)
// ---------------------------------------------------------------------------

export type ContactResult = { id: string | null; message: string };

/**
 * A contact form submission -> ContactInquiry NEW + `inquiry.created`
 * (NEW_INQUIRY notification for inquiries.view + `contact_ack` email to the
 * sender). A tripped honeypot returns the same success shape and stores
 * nothing so bots cannot tell they were caught.
 */
export async function createInquiryFromContact(input: { values: ContactValues; ip: string | null }): Promise<ContactResult> {
  const { values } = input;
  if (isHoneypotTripped(values)) return { id: null, message: CONTACT_ACCEPTED_MESSAGE };

  const orderNumber = values.orderNumber?.trim().toUpperCase() || null;
  const order = orderNumber ? await db.order.findUnique({ where: { orderNumber }, select: { id: true } }) : null;
  const type = values.type ?? (orderNumber ? "ORDER" : "GENERAL");

  const inquiry = await db.$transaction(async (tx) => {
    const created = await tx.contactInquiry.create({
      data: {
        name: stripHtml(values.name),
        email: values.email,
        phone: values.phone ?? null,
        subject: stripHtml(values.subject),
        // Stored as plain text; rendered with white-space: pre-wrap in the admin.
        message: stripHtml(values.message) || values.message,
        type,
        orderId: order?.id ?? null,
        status: "NEW",
        priority: type === "COMPLAINT" ? "HIGH" : "NORMAL",
      },
      select: { id: true },
    });
    await emitEvent(
      "inquiry.created",
      { inquiryId: created.id, name: values.name, email: values.email, subject: values.subject, type },
      tx,
    );
    return created;
  });

  return { id: inquiry.id, message: CONTACT_ACCEPTED_MESSAGE };
}

// ---------------------------------------------------------------------------
// Replies and notes
// ---------------------------------------------------------------------------

export type ReplyResult = { replyId: string; emailQueued: boolean; status: InquiryStatus };

/**
 * A public reply: stored, emailed to the inquirer with the store signature,
 * and the inquiry moves to REPLIED. The email is queued inside the same
 * transaction so the outbox row and the reply row commit (or fail) together.
 */
export async function addInquiryReply(
  input: { inquiryId: string; message: string; actor: InquiryActor } & ClientInfo,
): Promise<ReplyResult> {
  const html = sanitizeHtml(input.message.includes("<") ? input.message : textToHtml(input.message), "basic").trim();
  if (!html) throw badRequest("The reply is empty after removing unsupported markup.", { message: "Empty." });

  return db.$transaction(async (tx) => {
    const inquiry = await requireInquiry(tx, input.inquiryId);
    const common = await commonEmailVars(tx);
    const storeName = String(common.store_name ?? "");
    const supportEmail = String(common.support_email ?? "");
    const signature = `<p style="margin-top:16px;color:#666;font-size:12px">— ${escapeHtml(input.actor.name ?? "The team")}, ${escapeHtml(storeName)}${
      supportEmail ? `<br/>${escapeHtml(supportEmail)}` : ""
    }</p>`;
    const quoted = `<hr style="margin:20px 0;border:0;border-top:1px solid #ddd"/><p style="color:#888;font-size:12px">You wrote:</p><blockquote style="color:#666;font-size:12px;margin:0;padding-left:12px;border-left:3px solid #ddd">${textToHtml(
      inquiry.message,
    )}</blockquote>`;
    const body = `${html}${signature}${quoted}`;

    const reply = await tx.inquiryReply.create({
      data: { inquiryId: inquiry.id, message: html, authorId: actorId(input.actor), isInternal: false, emailSent: false },
      select: { id: true },
    });

    const email = await queueRawEmail({
      to: { email: inquiry.email, name: inquiry.name },
      subject: `Re: ${inquiry.subject}`,
      html: body,
      text: htmlToText(body),
      entity: { type: "InquiryReply", id: reply.id },
      dedupeKey: `inquiry_reply:${reply.id}`,
      tx,
    });
    if (email.queued) await tx.inquiryReply.update({ where: { id: reply.id }, data: { emailSent: true } });

    const status: InquiryStatus = "REPLIED";
    await tx.contactInquiry.update({ where: { id: inquiry.id }, data: { status, resolvedAt: null } });
    await writeAudit(tx, {
      actor: input.actor,
      action: "inquiry.reply",
      entityType: "ContactInquiry",
      entityId: inquiry.id,
      entityLabel: inquiry.subject,
      summary: `Replied to ${inquiry.name} <${inquiry.email}>${email.queued ? "" : " (email not queued)"}.`,
      diff: diffOf({ status: inquiry.status }, { status }),
      ip: input.ip,
    });
    return { replyId: reply.id, emailQueued: email.queued, status };
  });
}

/** Staff-only note; never emailed, never shown to the customer. */
export async function addInquiryNote(input: { inquiryId: string; message: string; actor: InquiryActor } & ClientInfo): Promise<{ replyId: string }> {
  const html = sanitizeHtml(input.message.includes("<") ? input.message : textToHtml(input.message), "basic").trim();
  if (!html) throw badRequest("The note is empty.", { message: "Empty." });
  return db.$transaction(async (tx) => {
    const inquiry = await requireInquiry(tx, input.inquiryId);
    const note = await tx.inquiryReply.create({
      data: { inquiryId: inquiry.id, message: html, authorId: actorId(input.actor), isInternal: true, emailSent: false },
      select: { id: true },
    });
    if (inquiry.status === "NEW") await tx.contactInquiry.update({ where: { id: inquiry.id }, data: { status: "OPEN" } });
    await writeAudit(tx, {
      actor: input.actor,
      action: "inquiry.note",
      entityType: "ContactInquiry",
      entityId: inquiry.id,
      entityLabel: inquiry.subject,
      summary: `Added an internal note.`,
      ip: input.ip,
    });
    return { replyId: note.id };
  });
}

function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

export async function updateInquiry(id: string, patch: InquiryPatchValues, actor: InquiryActor, client: ClientInfo = {}): Promise<InquiryRecord> {
  return db.$transaction(async (tx) => {
    const before = await requireInquiry(tx, id);
    const data: Prisma.ContactInquiryUpdateInput = {};
    if (patch.type !== undefined) data.type = patch.type;
    if (patch.priority !== undefined) data.priority = patch.priority;
    if (patch.subject !== undefined) data.subject = stripHtml(patch.subject);
    const after = await tx.contactInquiry.update({ where: { id }, data, select: INQUIRY_SELECT });
    await writeAudit(tx, {
      actor,
      action: "inquiry.update",
      entityType: "ContactInquiry",
      entityId: id,
      entityLabel: after.subject,
      summary: `Updated inquiry details.`,
      diff: diffOf({ type: before.type, priority: before.priority, subject: before.subject }, { type: after.type, priority: after.priority, subject: after.subject }),
      ip: client.ip,
    });
    return after;
  });
}

/** Assigning a NEW inquiry also opens it: someone is now looking at it. */
export async function assignInquiry(id: string, assignedToId: string | null, actor: InquiryActor, client: ClientInfo = {}): Promise<InquiryRecord> {
  return db.$transaction(async (tx) => {
    const before = await requireInquiry(tx, id);
    let assignee: { id: string; name: string | null; email: string } | null = null;
    if (assignedToId) {
      assignee = await tx.user.findFirst({ where: { id: assignedToId, isActive: true, deletedAt: null }, select: { id: true, name: true, email: true } });
      if (!assignee) throw badRequest("That user is not active.", { assignedToId: "Not an active admin user." });
    }
    const after = await tx.contactInquiry.update({
      where: { id },
      data: { assignedToId, status: before.status === "NEW" && assignedToId ? "OPEN" : before.status },
      select: INQUIRY_SELECT,
    });
    await writeAudit(tx, {
      actor,
      action: "inquiry.assign",
      entityType: "ContactInquiry",
      entityId: id,
      entityLabel: after.subject,
      summary: assignee ? `Assigned to ${assignee.name ?? assignee.email}.` : "Unassigned.",
      diff: diffOf({ assignedToId: before.assignedToId, status: before.status }, { assignedToId: after.assignedToId, status: after.status }),
      ip: client.ip,
    });
    return after;
  });
}

export async function setInquiryStatus(id: string, status: InquiryStatus, actor: InquiryActor, client: ClientInfo = {}): Promise<InquiryRecord> {
  return db.$transaction(async (tx) => {
    const before = await requireInquiry(tx, id);
    if (before.status === status) return before;
    const after = await tx.contactInquiry.update({
      where: { id },
      data: { status, resolvedAt: status === "RESOLVED" ? new Date() : null },
      select: INQUIRY_SELECT,
    });
    await writeAudit(tx, {
      actor,
      action: "inquiry.status_change",
      entityType: "ContactInquiry",
      entityId: id,
      entityLabel: after.subject,
      summary: `Marked ${INQUIRY_STATUS_META[status].label.toLowerCase()}.`,
      diff: diffOf({ status: before.status }, { status }),
      ip: client.ip,
    });
    return after;
  });
}

export type BulkInquiryResult = { op: BulkInquiryInput["op"]; requested: number; affected: number };

export async function bulkInquiries(input: BulkInquiryInput, actor: InquiryActor, client: ClientInfo = {}): Promise<BulkInquiryResult> {
  const ids = [...new Set(input.ids)];
  return db.$transaction(async (tx) => {
    let affected = 0;
    if (input.op === "assign") {
      if (input.assignedToId) {
        const user = await tx.user.findFirst({ where: { id: input.assignedToId, isActive: true, deletedAt: null }, select: { id: true } });
        if (!user) throw badRequest("That user is not active.", { assignedToId: "Not an active admin user." });
      }
      const result = await tx.contactInquiry.updateMany({ where: { id: { in: ids } }, data: { assignedToId: input.assignedToId ?? null } });
      if (input.assignedToId) await tx.contactInquiry.updateMany({ where: { id: { in: ids }, status: "NEW" }, data: { status: "OPEN" } });
      affected = result.count;
    } else {
      const status: InquiryStatus = input.op === "resolve" ? "RESOLVED" : input.op === "spam" ? "SPAM" : "OPEN";
      const result = await tx.contactInquiry.updateMany({
        where: { id: { in: ids }, status: { not: status } },
        data: { status, resolvedAt: status === "RESOLVED" ? new Date() : null },
      });
      affected = result.count;
    }
    await writeAudit(tx, {
      actor,
      action: `inquiry.bulk_${input.op}`,
      entityType: "ContactInquiry",
      summary: `Bulk ${input.op}: ${affected} of ${ids.length} inquiry(ies).`,
      diff: { op: input.op, requested: ids.length, affected, assignedToId: input.assignedToId ?? null, ids: ids.slice(0, 200) },
      ip: client.ip,
    });
    return { op: input.op, requested: ids.length, affected };
  });
}
