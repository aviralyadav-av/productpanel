/**
 * URL slugs, client-side.
 *
 * A copy of the rule in src/features/products/schemas.ts rather than an import,
 * so a shared component does not pull a feature module (and its zod schemas)
 * into every bundle that renders a form. The two must agree: lowercase ASCII,
 * digits and single hyphens, max 80 characters.
 */

/** Strips the combining marks that NFKD splits off, so "e-acute" slugs as "e". */
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(value: string): boolean {
  return value.length >= 2 && value.length <= 80 && SLUG_PATTERN.test(value);
}
