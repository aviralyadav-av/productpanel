"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";
import { NEWSLETTER_STATUS_META } from "@/lib/enums";

import {
  NEWSLETTER_BULK_PERMISSION,
  addSubscriberSchema,
  bulkSubscribersSchema,
  importSubscribersSchema,
  looseIdSchema,
  setSubscriberStatusSchema,
  updateSubscriberSchema,
  type AddSubscriberInput,
  type BulkSubscribersInput,
  type ImportSubscribersInput,
  type SetSubscriberStatusInput,
  type UpdateSubscriberInput,
} from "./schemas";
import {
  addSubscriber,
  applySubscriberImport,
  bulkSubscribers,
  deleteSubscriber,
  previewSubscriberImport,
  setSubscriberStatus,
  updateSubscriber,
  type BulkSubscribersResult,
} from "./service";
import type { ImportReport } from "./types";

/**
 * Server Actions behind /admin/newsletter: permission -> Zod -> service ->
 * revalidate -> ActionResult. Every rule lives in service.ts so the REST
 * handlers behave identically.
 */

const LIST_PATH = "/admin/newsletter";

export async function addSubscriberAction(input: AddSubscriberInput): Promise<ActionResult<{ id: string; email: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("newsletter.manage");
    const parsed = addSubscriberSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await addSubscriber(parsed.data, actor);
    revalidatePath(LIST_PATH);
    return ok({ id: row.id, email: row.email }, `${row.email} added.`);
  });
}

export async function updateSubscriberAction(input: UpdateSubscriberInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("newsletter.manage");
    const parsed = updateSubscriberSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await updateSubscriber(parsed.data.id, parsed.data.patch, actor);
    revalidatePath(LIST_PATH);
    return ok({ id: row.id }, "Saved.");
  });
}

export async function setSubscriberStatusAction(input: SetSubscriberStatusInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("newsletter.manage");
    const parsed = setSubscriberStatusSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await setSubscriberStatus(parsed.data.id, parsed.data.status, actor);
    revalidatePath(LIST_PATH);
    return ok({ id: row.id }, `${row.email} marked ${NEWSLETTER_STATUS_META[parsed.data.status].label.toLowerCase()}.`);
  });
}

export async function deleteSubscriberAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("newsletter.manage");
    const parsed = looseIdSchema.safeParse(id);
    if (!parsed.success) return fail("Invalid subscriber id.");
    const row = await deleteSubscriber(parsed.data, actor);
    revalidatePath(LIST_PATH);
    return ok({ id: row.id }, `${row.email} removed.`);
  });
}

export async function bulkSubscribersAction(input: BulkSubscribersInput): Promise<ActionResult<BulkSubscribersResult>> {
  return runAction(async () => {
    const parsed = bulkSubscribersSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const actor = await requirePermissionOrThrow(NEWSLETTER_BULK_PERMISSION[parsed.data.op]);
    const result = await bulkSubscribers(parsed.data, actor);
    revalidatePath(LIST_PATH);
    return ok(result, `${result.affected} subscriber${result.affected === 1 ? "" : "s"} updated.`);
  });
}

/**
 * One action for both steps of the import: `apply: false` reports what would
 * happen, `apply: true` writes it. The dialog calls it twice with the same
 * text so the operator confirms the exact numbers they saw.
 */
export async function importSubscribersAction(input: ImportSubscribersInput): Promise<ActionResult<ImportReport>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("newsletter.manage");
    const parsed = importSubscribersSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const report = parsed.data.apply ? await applySubscriberImport(parsed.data, actor) : await previewSubscriberImport(parsed.data);
    if (parsed.data.apply) revalidatePath(LIST_PATH);

    // The report is returned even when the file is rejected: the dialog needs
    // the per-row messages to tell the operator which lines to fix.
    if (report.fileErrors.length > 0) return ok(report, report.fileErrors[0]);
    return ok(
      report,
      report.dryRun
        ? `${report.toCreate} to add, ${report.toUpdate} to update.`
        : `Imported ${report.created} new and updated ${report.updated} subscriber(s).`,
    );
  });
}
