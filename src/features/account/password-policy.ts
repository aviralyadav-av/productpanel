import { z } from "zod";

/**
 * Password rules for admin accounts (blueprint §14.D10: minimum 12 characters,
 * must not contain the account's email or name).
 *
 * Length is the only hard complexity rule on purpose: mandatory symbol/digit
 * classes push people towards "Password1!" while a 12-character floor does
 * more against brute force than any class rule. The "not your own name or
 * email" check stops the most common weak choice an operator actually makes.
 *
 * Pure module: shared by the change-password action, the reset action and
 * (later) the users module's invite flow.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const BCRYPT_ROUNDS = 12;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, {
    message: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  })
  .max(PASSWORD_MAX_LENGTH, { message: `Use at most ${PASSWORD_MAX_LENGTH} characters.` });

export type PasswordContext = {
  email?: string | null;
  name?: string | null;
};

/**
 * Words from the identity that must not appear in the password: the email's
 * local part and its dot/plus-separated pieces, plus every name token of four
 * or more letters (shorter tokens like "Li" would reject too much).
 */
function forbiddenFragments({ email, name }: PasswordContext): string[] {
  const fragments = new Set<string>();
  const local = (email ?? "").toLowerCase().split("@")[0] ?? "";
  if (local.length >= 4) fragments.add(local);
  for (const part of local.split(/[.+_-]/)) {
    if (part.length >= 4) fragments.add(part);
  }
  for (const part of (name ?? "").toLowerCase().split(/\s+/)) {
    if (part.length >= 4) fragments.add(part);
  }
  return [...fragments];
}

/**
 * Returns a human sentence when the password is unacceptable, else null.
 * The caller decides whether that becomes a field error or an ApiError.
 */
export function passwordProblem(password: string, context: PasswordContext = {}): string | null {
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Choose a longer password.";

  const lower = password.toLowerCase();
  for (const fragment of forbiddenFragments(context)) {
    if (lower.includes(fragment)) {
      return "The password must not contain your name or email address.";
    }
  }

  if (/^(.)\1+$/.test(password)) return "Choose a password that is not one repeated character.";

  return null;
}
