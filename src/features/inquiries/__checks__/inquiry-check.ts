import "dotenv/config";

import { db } from "@/lib/db";

import { contactSchema } from "@/features/inquiries/schemas";
import {
  addInquiryNote,
  addInquiryReply,
  assignInquiry,
  bulkInquiries,
  createInquiryFromContact,
  setInquiryStatus,
  updateInquiry,
} from "@/features/inquiries/service";

/**
 * End-to-end check against the REAL database:
 *
 *   npx tsx src/features/inquiries/__checks__/inquiry-check.ts
 *
 * Walks a contact message through its whole life - public intake (honeypot,
 * order linking, acknowledgement email), assignment, an internal note, a
 * public reply that must reach the outbox, triage and bulk spam - and asserts
 * the two rules that are easy to get wrong: an internal note is never emailed,
 * and a reply always lands in the outbox with `emailSent` recording it.
 * Everything it creates is deleted again.
 */

const STAMP = Date.now();
const ACTOR = { id: "system", email: "system@diybaazar.local", name: "Check Bot" };
const EMAIL = `check_inq_${STAMP}@example.invalid`;
const TRAP_EMAIL = `check_inq_${STAMP}_trap@example.invalid`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

async function outboxCount(email: string): Promise<number> {
  return db.emailOutbox.count({ where: { toEmail: email } });
}

async function main(): Promise<void> {
  /** Tracked outside the try so the cleanup can remove the bell notifications too. */
  let inquiryId: string | null = null;
  try {
    const order = await db.order.findFirst({ where: { id: { startsWith: "demo_" } }, select: { id: true, orderNumber: true } });
    assert(order, "a demo order exists (run the seed first)");
    const assignee = await db.user.findFirst({
      where: { isActive: true, deletedAt: null, id: { not: "system" } },
      select: { id: true, name: true, email: true },
    });
    assert(assignee, "an active admin user exists to assign to");

    // 1. Honeypot: identical answer, nothing stored.
    const trap = await createInquiryFromContact({
      values: contactSchema.parse({
        name: "Spam Bot",
        email: TRAP_EMAIL,
        subject: "Cheap backlinks",
        message: "Buy links from us today, best prices.",
        website: "http://spam.example",
      }),
      ip: "127.0.0.1",
    });
    assert(trap.id === null, "the honeypot submission stored nothing");
    assert((await db.contactInquiry.count({ where: { email: TRAP_EMAIL } })) === 0, "no inquiry row for the honeypot submission");

    // 2. A real submission quoting an order number links the order and types itself ORDER.
    const intake = await createInquiryFromContact({
      values: contactSchema.parse({
        name: "Check Bot",
        email: EMAIL,
        phone: "98765 43210",
        subject: `Check inquiry ${STAMP}`,
        message: "Where is my parcel?\n\nIt was due yesterday.",
        orderNumber: order.orderNumber.toLowerCase(),
      }),
      ip: "127.0.0.1",
    });
    assert(intake.id && intake.message === trap.message, "a real submission is accepted with the same message as the honeypot");

    const created = await db.contactInquiry.findUniqueOrThrow({ where: { id: intake.id } });
    inquiryId = created.id;
    assert(created.status === "NEW", "a new inquiry lands as NEW");
    assert(created.orderId === order.id, `the order number resolved to the order (${created.orderId} vs ${order.id})`);
    assert(created.type === "ORDER", "an inquiry quoting an order number is typed ORDER");
    assert(created.phone === "+919876543210", "the phone number is normalised");
    assert((await outboxCount(EMAIL)) === 1, "the contact_ack acknowledgement was queued to the sender");
    const notified = await db.notification.count({ where: { entityType: "ContactInquiry", entityId: created.id } });
    assert(notified > 0, "inquiries.view users were notified (NEW_INQUIRY)");

    // 3. Assigning a NEW inquiry opens it.
    const assigned = await assignInquiry(created.id, assignee.id, ACTOR);
    assert(assigned.assignedToId === assignee.id && assigned.status === "OPEN", "assigning a NEW inquiry opens it");

    // 4. Triage fields.
    const triaged = await updateInquiry(created.id, { priority: "HIGH", type: "COMPLAINT" }, ACTOR);
    assert(triaged.priority === "HIGH" && triaged.type === "COMPLAINT", "priority and type are editable");

    // 5. An internal note never leaves the building.
    const beforeNote = await outboxCount(EMAIL);
    const note = await addInquiryNote({ inquiryId: created.id, message: "Courier says it is at the hub.", actor: ACTOR });
    assert((await outboxCount(EMAIL)) === beforeNote, "an internal note queues no email");
    const noteRow = await db.inquiryReply.findUniqueOrThrow({ where: { id: note.replyId } });
    assert(noteRow.isInternal && !noteRow.emailSent, "the note is flagged internal and not sent");
    assert((await db.contactInquiry.findUniqueOrThrow({ where: { id: created.id } })).status === "OPEN", "a note does not change an open status");

    // 6. A public reply is stored, sanitised, emailed, and moves the inquiry to REPLIED.
    const reply = await addInquiryReply({
      inquiryId: created.id,
      message: "It is out for delivery <b>today</b>.<script>alert(1)</script>",
      actor: ACTOR,
    });
    assert(reply.emailQueued, "the reply was queued to the outbox");
    assert(reply.status === "REPLIED", "replying moves the inquiry to REPLIED");
    assert((await outboxCount(EMAIL)) === beforeNote + 1, "exactly one email per reply");
    const replyRow = await db.inquiryReply.findUniqueOrThrow({ where: { id: reply.replyId } });
    assert(!replyRow.isInternal && replyRow.emailSent, "the reply is public and marked sent");
    assert(!replyRow.message.includes("<script"), "the reply is sanitised before it is stored");
    const mail = await db.emailOutbox.findFirstOrThrow({ where: { toEmail: EMAIL }, orderBy: { createdAt: "desc" } });
    assert(mail.subject.startsWith("Re: "), "the reply email is a Re: of the original subject");
    assert(mail.htmlBody.includes("Check Bot"), "the reply carries the responder's signature");

    // 7. Resolve, then bulk spam.
    const resolved = await setInquiryStatus(created.id, "RESOLVED", ACTOR);
    assert(resolved.status === "RESOLVED" && resolved.resolvedAt, "resolving stamps resolvedAt");
    const spam = await bulkInquiries({ ids: [created.id], op: "spam" }, ACTOR);
    assert(spam.affected === 1, "bulk spam affected one row");
    const afterSpam = await db.contactInquiry.findUniqueOrThrow({ where: { id: created.id } });
    assert(afterSpam.status === "SPAM" && afterSpam.resolvedAt === null, "spam clears resolvedAt");

    // 8. Audit trail (D13).
    const audits = await db.auditLog.findMany({ where: { entityType: "ContactInquiry", entityId: created.id }, select: { action: true } });
    const actions = new Set(audits.map((audit) => audit.action));
    for (const action of ["inquiry.assign", "inquiry.update", "inquiry.note", "inquiry.reply", "inquiry.status_change"]) {
      assert(actions.has(action), `audit row written for ${action} (saw ${[...actions].join(", ")})`);
    }
    // The public submission itself is deliberately NOT audited: it is the
    // customer's own message, recorded by the inquiry row, not an admin action.

    console.log("inquiry-check PASSED", {
      inquiry: created.id,
      order: order.orderNumber,
      emailsQueued: await outboxCount(EMAIL),
      auditActions: [...actions].sort(),
    });
  } finally {
    // Replies cascade with the inquiry; the outbox rows are ours to clean up.
    await db.contactInquiry.deleteMany({ where: { email: { startsWith: "check_inq_", mode: "insensitive" } } });
    await db.emailOutbox.deleteMany({ where: { toEmail: { startsWith: "check_inq_", mode: "insensitive" } } }).catch(() => undefined);
    if (inquiryId) await db.notification.deleteMany({ where: { entityType: "ContactInquiry", entityId: inquiryId } }).catch(() => undefined);
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
