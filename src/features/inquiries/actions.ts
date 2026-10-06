"use server";

import { revalidatePath } from "next/cache";

import { ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";
import { INQUIRY_STATUS_META } from "@/lib/enums";

import {
  assignInquirySchema,
  bulkInquirySchema,
  inquiryNoteSchema,
  inquiryReplySchema,
  setInquiryStatusSchema,
  updateInquirySchema,
  type AssignInquiryInput,
  type BulkInquiryInput,
  type InquiryNoteInput,
  type InquiryReplyInput,
  type SetInquiryStatusInput,
  type UpdateInquiryInput,
} from "./schemas";
import {
  addInquiryNote,
  addInquiryReply,
  assignInquiry,
  bulkInquiries,
  setInquiryStatus,
  updateInquiry,
  type BulkInquiryResult,
  type ReplyResult,
} from "./service";

/** Server Actions behind /admin/inquiries: permission -> Zod -> service -> revalidate -> ActionResult. */

const LIST_PATH = "/admin/inquiries";

function revalidate(id?: string): void {
  revalidatePath(LIST_PATH);
  if (id) revalidatePath(`${LIST_PATH}/${id}`);
}

export async function replyToInquiryAction(input: InquiryReplyInput): Promise<ActionResult<ReplyResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("inquiries.manage");
    const parsed = inquiryReplySchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await addInquiryReply({ inquiryId: parsed.data.inquiryId, message: parsed.data.message, actor });
    revalidate(parsed.data.inquiryId);
    return ok(result, result.emailQueued ? "Reply sent." : "Reply saved, but the email could not be queued - check the outbox.");
  });
}

export async function addInquiryNoteAction(input: InquiryNoteInput): Promise<ActionResult<{ replyId: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("inquiries.manage");
    const parsed = inquiryNoteSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await addInquiryNote({ inquiryId: parsed.data.inquiryId, message: parsed.data.message, actor });
    revalidate(parsed.data.inquiryId);
    return ok(result, "Note added.");
  });
}

export async function updateInquiryAction(input: UpdateInquiryInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("inquiries.manage");
    const parsed = updateInquirySchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const inquiry = await updateInquiry(parsed.data.id, parsed.data.patch, actor);
    revalidate(inquiry.id);
    return ok({ id: inquiry.id }, "Saved.");
  });
}

export async function assignInquiryAction(input: AssignInquiryInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("inquiries.manage");
    const parsed = assignInquirySchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const inquiry = await assignInquiry(parsed.data.id, parsed.data.assignedToId, actor);
    revalidate(inquiry.id);
    return ok({ id: inquiry.id }, parsed.data.assignedToId ? "Assigned." : "Unassigned.");
  });
}

export async function setInquiryStatusAction(input: SetInquiryStatusInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("inquiries.manage");
    const parsed = setInquiryStatusSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const inquiry = await setInquiryStatus(parsed.data.id, parsed.data.status, actor);
    revalidate(inquiry.id);
    return ok({ id: inquiry.id }, `Marked ${INQUIRY_STATUS_META[parsed.data.status].label.toLowerCase()}.`);
  });
}

export async function bulkInquiriesAction(input: BulkInquiryInput): Promise<ActionResult<BulkInquiryResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("inquiries.manage");
    const parsed = bulkInquirySchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await bulkInquiries(parsed.data, actor);
    revalidate();
    return ok(result, `${result.affected} inquir${result.affected === 1 ? "y" : "ies"} updated.`);
  });
}
