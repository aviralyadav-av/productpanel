import { z } from "zod";

import { paiseToRupees, rupeesToPaise } from "@/lib/money";

/**
 * Setting is a typed key/value registry: its `type` decides which control renders
 * and how the submitted string is validated on the way back in. The seeder
 * owns the rows, their labels and their help text - this file only describes
 * how to edit them safely.
 */

export const SETTING_GROUPS = [
  "general",
  "shipping",
  "inventory",
  "alerts",
  "seo",
  "social",
] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

/**
 * `system` holds demo.ordersSeeded, which the seeder writes and the dashboard
 * reads to decide whether to warn that sample orders are present. Letting an
 * operator flip it by hand would only make the dashboard lie, so the group is
 * never rendered or accepted.
 */
export const HIDDEN_SETTING_GROUPS = new Set(["system"]);

export const SETTING_TYPES = [
  "string",
  "number",
  "boolean",
  "money",
  "json",
] as const;
export type SettingType = (typeof SETTING_TYPES)[number];

export const SETTING_GROUP_META: Record<
  string,
  { label: string; description: string }
> = {
  general: {
    label: "General",
    description:
      "Store identity and locale. The sidebar reads the store name from here.",
  },
  shipping: {
    label: "Shipping",
    description:
      "The public order endpoint computes shipping from these two values. The storefront still applies its own hardcoded rule.",
  },
  inventory: {
    label: "Inventory",
    description: "Defaults applied when a variant has no threshold of its own.",
  },
  alerts: {
    label: "Alerts",
    description:
      "Thresholds behind the dashboard's Needs attention panel. These take effect immediately.",
  },
  seo: {
    label: "SEO",
    description:
      "Fallback meta title and description for pages that set none of their own.",
  },
  social: {
    label: "Social",
    description: "Profile links. The storefront footer does not read them yet.",
  },
};

export function settingGroupLabel(group: string): string {
  return (
    SETTING_GROUP_META[group]?.label ??
    group.charAt(0).toUpperCase() + group.slice(1)
  );
}

// ---------------------------------------------------------------------------
// Values
//
// Everything in this table is stored as a string, including money and numbers.
// The form always holds the DISPLAY form (rupees for money, "true"/"false" for
// booleans) and the action converts back, so the two directions live side by
// side and cannot drift apart.
// ---------------------------------------------------------------------------

export function settingDisplayValue(type: string, stored: string): string {
  if (type === "money") {
    const paise = Number(stored);
    return Number.isFinite(paise) ? String(paiseToRupees(paise)) : "";
  }
  return stored;
}

export type CoercedValue =
  | { ok: true; value: string }
  | { ok: false; message: string };

export function coerceSettingValue(type: string, raw: string): CoercedValue {
  const trimmed = raw.trim();

  switch (type) {
    case "boolean":
      return trimmed === "true" || trimmed === "false"
        ? { ok: true, value: trimmed }
        : { ok: false, message: "Must be on or off." };

    case "number": {
      if (trimmed === "") return { ok: false, message: "Enter a number." };
      const value = Number(trimmed);
      if (!Number.isFinite(value)) return { ok: false, message: "Enter a number." };
      if (!Number.isInteger(value))
        return { ok: false, message: "Whole numbers only." };
      if (value < 0) return { ok: false, message: "Cannot be negative." };
      return { ok: true, value: String(value) };
    }

    case "money": {
      if (trimmed === "")
        return { ok: false, message: "Enter an amount in rupees." };
      const rupees = Number(trimmed);
      if (!Number.isFinite(rupees) || rupees < 0)
        return { ok: false, message: "Enter an amount in rupees." };
      // Stored in paise, typed in rupees. One conversion, in one place.
      return { ok: true, value: String(rupeesToPaise(rupees)) };
    }

    case "json":
      return { ok: false, message: "JSON settings are read-only here." };

    default:
      if (trimmed.length > 500)
        return { ok: false, message: "Keep this under 500 characters." };
      return { ok: true, value: trimmed };
  }
}

// ---------------------------------------------------------------------------
// Action inputs
// ---------------------------------------------------------------------------

/**
 * `group` is a free string rather than the enum above: a group added to the
 * registry later still renders, and refusing to save it would be worse than
 * accepting it. The action rejects hidden groups explicitly.
 */
export const updateSettingsSchema = z.object({
  group: z.string().min(1).max(40),
  values: z.record(z.string().min(1).max(120), z.string().max(2000)),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export const updateAdminProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { message: "Enter your name." })
    .max(80, { message: "That name is too long." }),
  email: z.email({ message: "Enter a valid email address." }).max(160),
  /** Only required when the email actually changes - checked in the action. */
  currentPassword: z.string().max(200).optional(),
});
export type UpdateAdminProfileInput = z.infer<typeof updateAdminProfileSchema>;

/**
 * Ten, not eight. This account can edit every price and read every customer
 * address in the store, and the lockout in src/lib/auth/index.ts only slows an
 * online guess - it does nothing for an offline one.
 */
export const MIN_PASSWORD_LENGTH = 10;

export const changePasswordSchema = z.object({
  currentPassword: z
    .string()
    .min(1, { message: "Enter your current password." })
    .max(200),
  newPassword: z
    .string()
    .min(MIN_PASSWORD_LENGTH, {
      message: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    })
    .max(200),
  confirmPassword: z
    .string()
    .min(1, { message: "Repeat the new password." })
    .max(200),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
