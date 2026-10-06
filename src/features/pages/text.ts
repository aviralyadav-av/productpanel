/**
 * Pure text helpers for CMS content (pages, blog, FAQs). Client-safe: no
 * sanitize-html, no Prisma - the word counter runs on every keystroke in the
 * editor, so it must be cheap and bundle-light. The server re-derives the
 * same numbers on save with the same functions, which keeps the "~4 min read"
 * the operator saw in the editor equal to what the storefront prints.
 */

/** Average adult reading speed used by most publishing tools (Medium: 265). */
export const WORDS_PER_MINUTE = 230;

/**
 * Plain text from operator HTML without a parser: tags become spaces so
 * `<p>a</p><p>b</p>` counts as two words, and the handful of entities the
 * editor emits are decoded so `&amp;` is not counted as a word.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words in the rendered text of an HTML fragment. */
export function countWords(html: string | null | undefined): number {
  const text = htmlToText(html);
  if (!text) return 0;
  return text.split(" ").filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/**
 * Reading time in whole minutes, never 0 for non-empty content: a 40-word
 * announcement is "1 min read", not "0 min read". Empty content is 0 so the
 * column can stay NULL until something is written.
 */
export function readingMinutes(wordsOrHtml: number | string | null | undefined): number {
  const words = typeof wordsOrHtml === "number" ? wordsOrHtml : countWords(wordsOrHtml);
  if (words <= 0) return 0;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

/** "4 min read" / "1 min read" for badges and the editor footer. */
export function formatReadingTime(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return "—";
  return `${minutes} min read`;
}

/** First sentence(s) of the body, for an excerpt placeholder. */
export function excerptFromHtml(html: string | null | undefined, max = 160): string {
  const text = htmlToText(html);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).trimEnd()}…`;
}

/**
 * Slug de-duplication for CREATE (§11.23): `base`, then `base-2`, `base-3` …
 * until one is not in `taken`. The suffix is trimmed into the length budget
 * so a 120-character title still yields a valid slug. Edits never call this -
 * a duplicate on edit is an explicit error, because silently renaming a
 * published URL is worse than a validation message.
 */
export function nextAvailableSlug(base: string, taken: ReadonlySet<string> | readonly string[], maxLength = 120): string {
  const set = taken instanceof Set ? taken : new Set(taken);
  const root = base.slice(0, maxLength).replace(/-+$/g, "") || "item";
  if (!set.has(root)) return root;
  for (let n = 2; n < 10_000; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${root.slice(0, maxLength - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!set.has(candidate)) return candidate;
  }
  return `${root.slice(0, maxLength - 14)}-${Date.now().toString(36)}`;
}

/** Tag normalisation shared by the blog editor and the service: trim, collapse spaces, lowercase, dedupe. */
export function normalizeTags(tags: readonly string[], max = 20): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, " ").toLowerCase().slice(0, 40);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}
