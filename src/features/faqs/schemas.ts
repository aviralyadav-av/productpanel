import { z } from "zod";

import { one, type SearchParams } from "@/lib/list-params";
import { textSchema } from "@/lib/validation";

import { parseFlag } from "@/features/pages/schemas";
import { htmlToText } from "@/features/pages/text";

/**
 * FAQ contract (blueprint §4.8 Faq, §11.21). Client-safe so the inline editor
 * validates with the same schema the action does.
 *
 * `group` is a free-text label, not a table: the storefront accordion groups
 * enabled rows by it and orders groups by the global `position` of their
 * first question. That is why the service renumbers positions across ALL
 * groups after every move - group order on the storefront follows the order
 * the admin shows, not the accident of creation time.
 */

export const DEFAULT_FAQ_GROUP = "General";

export const faqIdSchema = z.string().trim().min(1, "Missing FAQ id.");

/** Trim, collapse whitespace, fall back to the default group. Shared by the form and the service. */
export function normalizeGroupName(raw: string | null | undefined): string {
  const name = (raw ?? "").replace(/\s+/g, " ").trim();
  return name || DEFAULT_FAQ_GROUP;
}

export const faqGroupNameSchema = z
  .string()
  .max(60, "Group names are at most 60 characters.")
  .transform((value) => normalizeGroupName(value));

/**
 * HTML accepted raw; the SERVICE sanitises with the `basic` profile (§11.21).
 * The refine tests the RENDERED text, not the markup: the rich-text editor
 * emits `<p></p>` for an empty body, which would otherwise pass `min(1)` and
 * publish a question whose answer is a blank paragraph.
 */
export const faqAnswerSchema = z
  .string()
  .trim()
  .min(1, "An answer is required.")
  .max(20_000, "The answer is too long.")
  .refine((value) => htmlToText(value).length > 0, "An answer is required.");

export const faqFormSchema = z.object({
  question: textSchema(300, "Question"),
  answer: faqAnswerSchema,
  group: faqGroupNameSchema.default(DEFAULT_FAQ_GROUP),
  enabled: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
});
export type FaqFormInput = z.input<typeof faqFormSchema>;
export type FaqFormValues = z.output<typeof faqFormSchema>;

/** PUT semantics with every field optional; an empty patch is a no-op. */
export const faqPatchSchema = faqFormSchema.partial();
export type FaqPatchInput = z.input<typeof faqPatchSchema>;
export type FaqPatchValues = z.output<typeof faqPatchSchema>;

export const FAQ_FLAGS = ["enabled", "isFeatured"] as const;
export type FaqFlag = (typeof FAQ_FLAGS)[number];
export const faqFlagSchema = z.object({ flag: z.enum(FAQ_FLAGS), value: z.boolean() });

/** Full order of one group; ids not listed keep their relative order after the listed ones. */
export const faqReorderSchema = z.object({
  group: faqGroupNameSchema,
  ids: z.array(faqIdSchema).min(1).max(500),
});
export type FaqReorderInput = z.input<typeof faqReorderSchema>;

/** Renaming onto an existing group merges into it (its questions go last). */
export const faqGroupRenameSchema = z
  .object({ from: faqGroupNameSchema, to: faqGroupNameSchema })
  .refine((value) => value.from !== value.to, { path: ["to"], message: "Choose a different name." });
export type FaqGroupRenameInput = z.input<typeof faqGroupRenameSchema>;

/** Deleting a group never deletes questions: they move to `moveTo` (default group). */
export const faqGroupDeleteSchema = z
  .object({ group: faqGroupNameSchema, moveTo: faqGroupNameSchema.default(DEFAULT_FAQ_GROUP) })
  .refine((value) => value.group !== value.moveTo, { path: ["moveTo"], message: "Pick a different destination group." });
export type FaqGroupDeleteInput = z.input<typeof faqGroupDeleteSchema>;

/** Storefront order of the groups themselves. Groups not listed follow in their current order. */
export const faqGroupsReorderSchema = z.object({ groups: z.array(faqGroupNameSchema).min(1).max(200) });
export type FaqGroupsReorderInput = z.input<typeof faqGroupsReorderSchema>;

// ---------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------

export type FaqListFilters = {
  q?: string;
  group?: string;
  enabled?: boolean;
  featured?: boolean;
};

export function parseFaqListFilters(params: SearchParams | URLSearchParams): FaqListFilters {
  const get = (key: string) => (params instanceof URLSearchParams ? params.get(key) : one(params, key));
  return {
    q: get("q")?.trim() || undefined,
    group: get("group")?.trim() || undefined,
    enabled: parseFlag(get("enabled")),
    featured: parseFlag(get("featured")),
  };
}

export function isFaqFiltered(filters: FaqListFilters): boolean {
  return Boolean(filters.q || filters.group || filters.enabled !== undefined || filters.featured !== undefined);
}

// ---------------------------------------------------------------------------
// Read shapes
// ---------------------------------------------------------------------------

export type FaqRow = {
  id: string;
  question: string;
  /** Sanitised HTML as stored. */
  answer: string;
  group: string;
  position: number;
  enabled: boolean;
  isFeatured: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type FaqGroupView = {
  group: string;
  items: FaqRow[];
  /** Counts across the WHOLE group, not just the filtered rows shown. */
  total: number;
  enabled: number;
};

export type FaqGroupSummary = { group: string; count: number; enabled: number };

export type FaqBoardData = {
  groups: FaqGroupView[];
  /** Every group in storefront order with counts, for the filter tabs and move-to selects. */
  allGroups: FaqGroupSummary[];
  total: number;
  shown: number;
};
