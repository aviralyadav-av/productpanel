import type { z } from "zod";

/**
 * The one shape every Server Action returns.
 *
 * Field errors are keyed by field name so react-hook-form and plain
 * useActionState forms can both map them straight onto inputs, which is the
 * difference between "something went wrong" and a red outline on the field
 * that is actually wrong.
 */
export type ActionResult<T = void> =
  | { ok: true; data: T; message?: string }
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string>;
    };

export function ok<T>(data: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

export function fail(
  error: string,
  fieldErrors?: Record<string, string>,
): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

/** Flatten a Zod error into the field-keyed shape forms expect. */
export function zodFail(error: z.ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return {
    ok: false,
    error: "Please correct the highlighted fields.",
    fieldErrors,
  };
}

/**
 * Wraps an action body so an unexpected throw becomes a typed failure instead
 * of a Next.js error overlay. Redirect and notFound signals are rethrown -
 * Next implements those as exceptions and swallowing them breaks navigation.
 */
export async function runAction<T>(
  body: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await body();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      typeof (error as { digest?: unknown }).digest === "string" &&
      ((error as { digest: string }).digest.startsWith("NEXT_REDIRECT") ||
        (error as { digest: string }).digest === "NEXT_NOT_FOUND")
    ) {
      throw error;
    }

    console.error("ACTION FAILED", error);

    // Prisma's unique-constraint violation is the one database error an
    // operator can actually act on, so it gets a human sentence.
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return fail("That value is already taken. Try a different one.");
    }

    return fail("Something went wrong. The change was not saved.");
  }
}
