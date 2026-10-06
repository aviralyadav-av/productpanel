"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminOrThrow } from "@/lib/auth/guards";
import { ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { markRead } from "@/features/notifications/service";

/**
 * Shell-level Server Actions: the notification bell's mark-read. The bell
 * only ever touches the ACTOR'S OWN rows - markRead() scopes by userId - so
 * no permission beyond "signed in" is needed, and there is no way to mark
 * a colleague's notifications read from here.
 */

const markReadSchema = z.union([
  z.literal("all"),
  z.array(z.string().min(1).max(64)).min(1).max(100),
]);

export async function markNotificationsRead(
  input: readonly string[] | "all",
): Promise<ActionResult<{ updated: number }>> {
  return runAction(async () => {
    const actor = await requireAdminOrThrow();
    const parsed = markReadSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const updated = await markRead(actor.id, parsed.data);

    // Every shell page shows the bell, so the badge must refresh wherever the
    // operator is; revalidating the /admin layout subtree does exactly that.
    revalidatePath("/admin", "layout");
    return ok({ updated });
  });
}
