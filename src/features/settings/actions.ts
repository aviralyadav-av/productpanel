"use server";

import { revalidatePath } from "next/cache";

import { ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";
import { SETTING_DEFINITIONS } from "@/lib/settings-keys";

import {
  emailTestSchema,
  saveProviderSchema,
  tabPermission,
  updateSettingsSchema,
  type EmailTestInput,
  type SaveProviderInput,
  type SettingsTab,
  type UpdateSettingsInput,
} from "./schemas";
import {
  saveProvider,
  sendTestEmail,
  testSmtpSettings,
  updateSettings,
  type SmtpTestOutcome,
} from "./service";

/**
 * Server Actions behind /admin/settings. Thin by design: permission -> zod ->
 * service -> revalidate.
 *
 * The permission is derived from the groups the submitted keys belong to, not
 * from a tab name in the payload: a form that smuggled a `security.*` key into
 * a Store save would otherwise bypass D14's super-admin-only codes.
 */
const PATH = "/admin/settings";

const GROUP_BY_KEY = new Map(SETTING_DEFINITIONS.map((item) => [item.key, item.group]));

function permissionsForKeys(keys: readonly string[]): string[] {
  const codes = new Set<string>(["settings.manage"]);
  for (const key of keys) {
    const group = GROUP_BY_KEY.get(key);
    if (group) codes.add(tabPermission(group as SettingsTab));
  }
  return [...codes];
}

export async function updateSettingsAction(
  input: UpdateSettingsInput,
): Promise<ActionResult<{ changedKeys: string[] }>> {
  return runAction(async () => {
    const parsed = updateSettingsSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    // Every code the submitted keys imply, checked one by one.
    const actor = await requirePermissionOrThrow("settings.manage");
    for (const code of permissionsForKeys(Object.keys(parsed.data.values))) {
      await requirePermissionOrThrow(code);
    }

    const result = await updateSettings(parsed.data.values, actor);
    revalidatePath(PATH);
    return ok(
      { changedKeys: result.changedKeys },
      result.changedKeys.length === 0
        ? "Nothing to save - no value changed."
        : `Saved ${result.changedKeys.length} setting${result.changedKeys.length === 1 ? "" : "s"}.`,
    );
  });
}

export async function saveProviderAction(
  input: SaveProviderInput,
): Promise<ActionResult<{ provider: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("settings.manage_payments");
    const parsed = saveProviderSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const config = await saveProvider(parsed.data, actor);
    revalidatePath(PATH);
    return ok({ provider: config.provider }, `${config.displayName} saved.`);
  });
}

export type EmailTestOutcome =
  | { mode: "connection"; result: SmtpTestOutcome }
  | { mode: "send"; queued: boolean; to: string; reason: string | null };

export async function testEmailAction(
  input: EmailTestInput,
): Promise<ActionResult<EmailTestOutcome>> {
  return runAction<EmailTestOutcome>(async () => {
    const actor = await requirePermissionOrThrow("settings.manage");
    const parsed = emailTestSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    if (parsed.data.mode === "connection") {
      const result = await testSmtpSettings(parsed.data.values);
      return ok<EmailTestOutcome>(
        { mode: "connection", result },
        result.ok ? "SMTP connection succeeded." : `SMTP test failed: ${result.error}`,
      );
    }

    const to = parsed.data.to?.trim() || actor.email;
    const sent = await sendTestEmail(to, actor);
    return ok<EmailTestOutcome>(
      { mode: "send", queued: sent.queued, to: sent.to, reason: sent.reason },
      sent.queued
        ? `Test email queued for ${sent.to}. The worker sends it within a minute.`
        : `Test email was not queued (${sent.reason}).`,
    );
  });
}
