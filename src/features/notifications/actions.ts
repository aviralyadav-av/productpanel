"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";
import { NOTIFICATION_TYPE_META } from "@/lib/enums";

import {
  markReadSchema,
  preferencesSchema,
  type MarkReadInput,
  type PreferencesInput,
} from "./schemas";
import {
  savePreferences,
  sendTestNotification,
  type SavePreferencesResult,
  type TestNotificationResult,
} from "./preferences";
import { markRead, unreadCount } from "./service";

/**
 * Server Actions for /admin/notifications - thin wrappers over ./preferences
 * and the frozen ./service, exactly as the REST routes are.
 *
 * Everything here is scoped to the SIGNED-IN actor: there is no "mark someone
 * else's notification read". `notifications.view` is therefore the only
 * permission involved - holding it means you have an inbox, and an inbox is
 * yours.
 */

const PATH = "/admin/notifications";

export type MarkReadResult = { count: number; unread: number };

export async function markNotificationsReadAction(
  input: MarkReadInput,
): Promise<ActionResult<MarkReadResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("notifications.view");
    const parsed = markReadSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const count = await markRead(actor.id, parsed.data.all ? "all" : (parsed.data.ids ?? []));
    const unread = await unreadCount(actor.id);
    revalidatePath(PATH);

    return ok(
      { count, unread },
      count === 0
        ? "Nothing left to mark - those were already read."
        : `Marked ${count} notification${count === 1 ? "" : "s"} read.`,
    );
  });
}

export async function saveNotificationPreferencesAction(
  input: PreferencesInput,
): Promise<ActionResult<SavePreferencesResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("notifications.view");
    const parsed = preferencesSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await savePreferences(actor, parsed.data.preferences);
    revalidatePath(PATH);

    return ok(
      result,
      result.saved === 0
        ? "Nothing to save - preferences are unchanged."
        : `Saved delivery preferences for ${result.saved} type${result.saved === 1 ? "" : "s"}.`,
    );
  });
}

export async function sendTestNotificationAction(): Promise<ActionResult<TestNotificationResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("notifications.view");
    if (!actor.email) return fail("Your account has no email address to send to.");

    const result = await sendTestNotification(actor);
    revalidatePath(PATH);

    return ok(
      result,
      result.emailQueued
        ? `Test notification created and an email queued to ${actor.email}.`
        : `Test notification created. Turn on email for "${NOTIFICATION_TYPE_META.SYSTEM.label}" below to receive it by email too.`,
    );
  });
}
