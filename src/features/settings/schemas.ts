/**
 * Client-safe vocabulary for /admin/settings (blueprint §14.E2, D4, D14).
 *
 * The tab strip, the generated form and the REST handlers all read the same
 * registry (src/lib/settings-keys.ts), so a key added there appears in the UI
 * without touching this module. What lives here is only what the registry
 * cannot know: which tab a key needs an extra permission for, which keys are
 * media ids, and the zod shapes for the two write endpoints.
 */
import { z } from "zod";

import {
  MARKETPLACE_CHARGE_CONDITIONS,
  MARKETPLACE_CHARGE_TYPES,
  PAYMENT_PROVIDERS,
  paymentProviderModeSchema,
  type SettingType,
} from "@/lib/enums";
import { SETTING_GROUPS, type SettingGroup } from "@/lib/settings-keys";
import { one, type SearchParams } from "@/lib/list-params";

/** The Payments tab is not a Setting group: it edits PaymentProviderConfig rows. */
export const PAYMENTS_TAB = "payments";
export type SettingsTab = SettingGroup | typeof PAYMENTS_TAB;

export const SETTINGS_TABS: readonly SettingsTab[] = [
  ...(Object.keys(SETTING_GROUPS) as SettingGroup[]),
  PAYMENTS_TAB,
];

export function resolveSettingsTab(raw: string | undefined): SettingsTab {
  return (SETTINGS_TABS as readonly string[]).includes(raw ?? "")
    ? (raw as SettingsTab)
    : "general";
}

export function parseSettingsTab(params: SearchParams): SettingsTab {
  return resolveSettingsTab(one(params, "tab"));
}

/**
 * D14: `settings.manage` is not enough for money rails or session policy -
 * those two tabs need a super-admin-only code on top.
 */
export function tabPermission(tab: SettingsTab): string {
  if (tab === PAYMENTS_TAB) return "settings.manage_payments";
  if (tab === "security") return "settings.manage_security";
  return "settings.manage";
}

export const TAB_LABELS: Record<SettingsTab, string> = {
  ...(Object.fromEntries(
    Object.entries(SETTING_GROUPS).map(([group, meta]) => [group, meta.label]),
  ) as Record<SettingGroup, string>),
  [PAYMENTS_TAB]: "Payments",
};

export const TAB_DESCRIPTIONS: Record<SettingsTab, string> = {
  ...(Object.fromEntries(
    Object.entries(SETTING_GROUPS).map(([group, meta]) => [group, meta.description]),
  ) as Record<SettingGroup, string>),
  [PAYMENTS_TAB]: "Gateways, credentials and the webhook URLs each provider must call.",
};

/** Keys whose value is a MediaAsset id, rendered with the media picker. */
export const MEDIA_SETTING_KEYS: readonly string[] = [
  "store.logo_media_id",
  "store.favicon_media_id",
  "seo.og_image_media_id",
];

export function isMediaSettingKey(key: string): boolean {
  return MEDIA_SETTING_KEYS.includes(key);
}

/** Long-form text keys that deserve a textarea rather than a single line. */
export const MULTILINE_SETTING_KEYS: readonly string[] = [
  "store.address",
  "seo.meta_description",
  "seo.robots_txt",
  "storefront.cors_origins",
];

// ---------------------------------------------------------------------------
// View models (dates are strings; no Prisma types cross into the client)
// ---------------------------------------------------------------------------

export type SecretState = { isSet: boolean; last4: string | null };

export type SettingFieldView = {
  key: string;
  type: SettingType;
  label: string;
  helpText: string;
  isPublic: boolean;
  /** The editable value. Secrets are always "" - the stored value never leaves the server (D4). */
  value: string;
  secret: SecretState | null;
  /** Hydrated preview for MEDIA_SETTING_KEYS. */
  media: { id: string; url: string; alt: string | null; filename: string } | null;
  updatedAt: string | null;
};

export type SettingsGroupView = {
  group: SettingGroup;
  label: string;
  description: string;
  fields: SettingFieldView[];
};

export type ProviderCredentialView = { key: string; isSet: boolean; last4: string | null };

export type PaymentProviderView = {
  provider: string;
  displayName: string;
  isEnabled: boolean;
  mode: "TEST" | "LIVE";
  position: number;
  supportedMethods: string[];
  settings: Record<string, unknown>;
  credentials: ProviderCredentialView[];
  implemented: boolean;
  webhookUrl: string;
};

// ---------------------------------------------------------------------------
// Write inputs
// ---------------------------------------------------------------------------

/**
 * `values` is key -> raw string, exactly as the generated form holds it. The
 * service validates each one against its definition, so this schema only has
 * to stop absurd payloads.
 */
export const updateSettingsSchema = z.object({
  values: z.record(z.string().min(1).max(120), z.string().max(20_000)),
});
export type UpdateSettingsInput = z.input<typeof updateSettingsSchema>;
export type UpdateSettingsValues = z.output<typeof updateSettingsSchema>;

export const chargeRuleSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, "A code is required.")
      .max(40)
      .regex(/^[A-Za-z0-9_]+$/, "Letters, digits and underscores only."),
    label: z.string().trim().min(1, "A label is required.").max(80),
    type: z.enum(MARKETPLACE_CHARGE_TYPES),
    valueBps: z.number().int().min(0).max(100_000).nullable().default(null),
    valuePaise: z.number().int().min(0).nullable().default(null),
    appliesWhen: z.enum(MARKETPLACE_CHARGE_CONDITIONS).default("ALWAYS"),
  })
  .superRefine((value, ctx) => {
    if (value.type === "PERCENT_OF_GROSS" && value.valueBps === null) {
      ctx.addIssue({ code: "custom", path: ["valueBps"], message: "Enter a percentage." });
    }
    if (value.type !== "PERCENT_OF_GROSS" && value.valuePaise === null) {
      ctx.addIssue({ code: "custom", path: ["valuePaise"], message: "Enter an amount." });
    }
  });
export type ChargeRuleValues = z.output<typeof chargeRuleSchema>;

/** The stored shape of marketplace.charges (B3): only the used value key survives. */
export function chargeRuleToSetting(row: ChargeRuleValues): Record<string, unknown> {
  return {
    code: row.code,
    label: row.label,
    type: row.type,
    appliesWhen: row.appliesWhen,
    ...(row.type === "PERCENT_OF_GROSS"
      ? { valueBps: row.valueBps ?? 0 }
      : { valuePaise: row.valuePaise ?? 0 }),
  };
}

export const saveProviderSchema = z.object({
  provider: z.enum(PAYMENT_PROVIDERS),
  isEnabled: z.boolean(),
  mode: paymentProviderModeSchema,
  displayName: z.string().trim().min(1).max(60),
  position: z.number().int().min(0).max(999).default(0),
  supportedMethods: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  /** Blank/absent = leave the stored secret alone (D4); null = clear it. */
  credentials: z.record(z.string().min(1).max(60), z.string().max(500).nullable()).default({}),
  settings: z.record(z.string().min(1).max(60), z.unknown()).default({}),
});
export type SaveProviderInput = z.input<typeof saveProviderSchema>;
export type SaveProviderValues = z.output<typeof saveProviderSchema>;

/** The email tab's two buttons: test the connection, or send a real message. */
export const emailTestSchema = z.object({
  mode: z.enum(["connection", "send"]),
  to: z.string().trim().max(160).optional(),
  /** Unsaved form values, so the buttons test what is on screen (blank = use saved). */
  values: z.record(z.string().min(1).max(120), z.string().max(2000)).default({}),
});
export type EmailTestInput = z.input<typeof emailTestSchema>;
export type EmailTestValues = z.output<typeof emailTestSchema>;
