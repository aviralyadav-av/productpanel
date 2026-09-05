"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";

import { db } from "@/lib/db";
import { requireAdminOrThrow } from "@/lib/auth/guards";
import { diffOf, writeAudit } from "@/lib/audit";
import {
  fail,
  ok,
  runAction,
  zodFail,
  type ActionResult,
} from "@/lib/action-result";
import {
  HIDDEN_SETTING_GROUPS,
  changePasswordSchema,
  coerceSettingValue,
  settingGroupLabel,
  updateAdminProfileSchema,
  updateSettingsSchema,
} from "./schemas";

/** bcrypt cost. Matches the seeder's hashes - do not lower it. */
const BCRYPT_ROUNDS = 12;

// ---------------------------------------------------------------------------
// Store settings
// ---------------------------------------------------------------------------

/**
 * Saves one group of the Setting registry.
 *
 * The submitted values are display values (rupees for money, "true"/"false"
 * for booleans); each one is validated against the `type` recorded on its own
 * row rather than against anything the client sent, so a tampered payload
 * cannot smuggle a string into a money field.
 */
export async function updateSettings(input: {
  group: string;
  values: Record<string, string>;
}): Promise<ActionResult<{ updated: number }>> {
  const actor = await requireAdminOrThrow();

  const parsed = updateSettingsSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  const { group, values } = parsed.data;

  return runAction<{ updated: number }>(async () => {
    if (HIDDEN_SETTING_GROUPS.has(group)) {
      return fail("That group is managed by the seeder and cannot be edited.");
    }

    const rows = await db.setting.findMany({ where: { group } });
    if (rows.length === 0) {
      return fail("That settings group no longer exists.");
    }

    const byKey = new Map(rows.map((row) => [row.key, row]));
    const fieldErrors: Record<string, string> = {};
    const writes: Array<{ key: string; value: string }> = [];
    const before: Record<string, string> = {};
    const after: Record<string, string> = {};

    for (const [key, raw] of Object.entries(values)) {
      const row = byKey.get(key);
      if (!row) {
        fieldErrors[key] = "This setting is not part of this group.";
        continue;
      }
      if (row.type === "json") continue; // read-only in the UI

      const coerced = coerceSettingValue(row.type, raw);
      if (!coerced.ok) {
        fieldErrors[key] = coerced.message;
        continue;
      }
      if (coerced.value === row.value) continue;

      writes.push({ key, value: coerced.value });
      before[key] = row.value;
      after[key] = coerced.value;
    }

    if (Object.keys(fieldErrors).length > 0) {
      return fail("Please correct the highlighted fields.", fieldErrors);
    }

    if (writes.length === 0) {
      return ok({ updated: 0 }, "Nothing to save - no values changed.");
    }

    await db.$transaction(
      writes.map((write) =>
        db.setting.update({
          where: { key: write.key },
          data: { value: write.value },
        }),
      ),
    );

    const plural = writes.length === 1 ? "" : "s";

    await writeAudit({
      actor,
      action: "settings.update",
      entityType: "Setting",
      entityId: group,
      summary: `Updated ${writes.length} ${settingGroupLabel(group).toLowerCase()} setting${plural}`,
      diff: diffOf(before, after),
    });

    revalidatePath("/settings");
    // The sidebar reads store.name from this table on every dashboard render.
    revalidatePath("/dashboard");

    return ok({ updated: writes.length }, `Saved ${writes.length} change${plural}.`);
  });
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

/**
 * Changing the sign-in email is a credential change, so it costs a password.
 * Changing the display name is not, so it does not.
 */
export async function updateAdminProfile(input: {
  name: string;
  email: string;
  currentPassword?: string;
}): Promise<ActionResult<void>> {
  const actor = await requireAdminOrThrow();

  const parsed = updateAdminProfileSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction<void>(async () => {
    const user = await db.user.findUnique({
      where: { id: actor.id },
      select: { id: true, name: true, email: true, passwordHash: true },
    });
    if (!user) return fail("Your account could not be loaded. Sign in again.");

    const name = parsed.data.name.trim();
    const email = parsed.data.email.trim().toLowerCase();
    const emailChanged = email !== user.email;

    if (emailChanged) {
      if (!parsed.data.currentPassword) {
        return fail("Enter your current password to change the sign-in email.", {
          currentPassword: "Required to change the email.",
        });
      }

      const valid = await bcrypt.compare(
        parsed.data.currentPassword,
        user.passwordHash,
      );
      if (!valid) {
        return fail("That is not your current password.", {
          currentPassword: "Incorrect password.",
        });
      }

      const taken = await db.user.findUnique({ where: { email } });
      if (taken) {
        return fail("Another account already uses that email.", {
          email: "Already in use.",
        });
      }
    }

    if (!emailChanged && name === (user.name ?? "")) {
      return ok(undefined, "Nothing to save - your profile is unchanged.");
    }

    await db.user.update({ where: { id: user.id }, data: { name, email } });

    await writeAudit({
      actor,
      action: "account.update",
      entityType: "User",
      entityId: user.id,
      summary: emailChanged
        ? `Changed own sign-in email from ${user.email} to ${email}`
        : "Updated own profile name",
      diff: diffOf({ name: user.name, email: user.email }, { name, email }),
    });

    revalidatePath("/settings");

    return ok(
      undefined,
      emailChanged
        ? `Saved. Sign in with ${email} from now on.`
        : "Profile saved.",
    );
  });
}

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<ActionResult<void>> {
  const actor = await requireAdminOrThrow();

  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction<void>(async () => {
    if (parsed.data.newPassword !== parsed.data.confirmPassword) {
      return fail("The two new passwords do not match.", {
        confirmPassword: "These do not match.",
      });
    }

    const user = await db.user.findUnique({
      where: { id: actor.id },
      select: { id: true, passwordHash: true },
    });
    if (!user) return fail("Your account could not be loaded. Sign in again.");

    const valid = await bcrypt.compare(
      parsed.data.currentPassword,
      user.passwordHash,
    );
    if (!valid) {
      return fail("That is not your current password.", {
        currentPassword: "Incorrect password.",
      });
    }

    const unchanged = await bcrypt.compare(
      parsed.data.newPassword,
      user.passwordHash,
    );
    if (unchanged) {
      return fail("The new password is the same as the current one.", {
        newPassword: "Choose a different password.",
      });
    }

    await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(parsed.data.newPassword, BCRYPT_ROUNDS),
      },
    });

    // No diff, deliberately. writeAudit redacts password fields, but the safest
    // password material is the kind that never reaches the logger at all.
    await writeAudit({
      actor,
      action: "account.password_change",
      entityType: "User",
      entityId: user.id,
      summary: "Changed own password",
    });

    revalidatePath("/settings");

    return ok(
      undefined,
      "Password changed. Sessions are signed JWTs with no server-side store, so any other signed-in session stays valid until it expires.",
    );
  });
}
