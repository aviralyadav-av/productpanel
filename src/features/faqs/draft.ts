import type { z } from "zod";

import { DEFAULT_FAQ_GROUP, faqFormSchema, type FaqFormInput, type FaqRow } from "./schemas";

/**
 * The shape the FAQ editors hold in React state. Client-safe (no Prisma, no
 * server-only): the board keeps one draft per row being edited and the dialog
 * keeps one for the new question, and both validate with the SAME schema the
 * action does - so a missing answer is caught before the round trip and worded
 * identically after it.
 *
 * Drafts are all-strings/booleans on purpose: an `<input>` cannot hold `null`,
 * and the schema's own defaults ("" group → General) do the normalising.
 */
export type FaqDraft = {
  question: string;
  answer: string;
  group: string;
  enabled: boolean;
  isFeatured: boolean;
};

export const EMPTY_FAQ_DRAFT: FaqDraft = { question: "", answer: "", group: "", enabled: true, isFeatured: false };

/** A draft seeded from an existing row, for the inline editor. */
export function toFaqDraft(row: FaqRow): FaqDraft {
  return { question: row.question, answer: row.answer, group: row.group, enabled: row.enabled, isFeatured: row.isFeatured };
}

/** A draft for a new question in a known group ("" = the default group). */
export function newFaqDraft(group?: string): FaqDraft {
  return { ...EMPTY_FAQ_DRAFT, group: group && group !== DEFAULT_FAQ_GROUP ? group : "" };
}

/** First message per field, in the shape the forms and ActionResult.fieldErrors both use. */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}

/**
 * What the storefront will get, approximately, for a draft answer.
 *
 * The service sanitises answers with the `basic` profile - paragraphs, lists,
 * emphasis and links only - but the shared rich-text editor offers headings,
 * quotes, code and images because pages and posts need them. Previewing the
 * raw draft would therefore show markup that is about to be deleted, which is
 * the one thing a preview must not do. This trims the same tags the profile
 * drops (headings become bold paragraphs so the words survive), and never
 * runs on stored content: the board and the storefront both read the real,
 * server-sanitised HTML. sanitize-html itself is a server package - shipping
 * it to the browser to make a preview exact would cost far more than the
 * approximation is worth.
 */
export function previewBasicHtml(html: string): string {
  return html
    .replace(/<(img|hr)\b[^>]*>/gi, "")
    .replace(/<\/?(figure|figcaption|table|thead|tbody|tr|th|td|pre|code|blockquote)\b[^>]*>/gi, "")
    .replace(/<h[1-6]\b[^>]*>/gi, "<p><strong>")
    .replace(/<\/h[1-6]>/gi, "</strong></p>");
}

export type DraftCheck = { ok: true; input: FaqFormInput } | { ok: false; errors: Record<string, string> };

/** Client-side validation of a draft; the action re-validates server-side regardless. */
export function checkFaqDraft(draft: FaqDraft): DraftCheck {
  const input: FaqFormInput = {
    question: draft.question,
    answer: draft.answer,
    group: draft.group,
    enabled: draft.enabled,
    isFeatured: draft.isFeatured,
  };
  const parsed = faqFormSchema.safeParse(input);
  return parsed.success ? { ok: true, input } : { ok: false, errors: fieldErrorsOf(parsed.error) };
}
