import type { z } from "zod";
import type { Prisma } from "@prisma/client";

/**
 * JSON payload columns are native Postgres `jsonb`, so Prisma hands back parsed
 * values already. These helpers exist to validate that a stored payload still
 * matches its current schema - which legitimately fails when a content type's
 * shape is changed and older rows have not been migrated. A single stale row
 * must not take down a whole admin page.
 */

export type Json = Prisma.JsonValue;

export function parseJsonWith<S extends z.ZodType>(
  value: unknown,
  schema: S,
  fallback: z.infer<S>,
): z.infer<S> {
  const result = schema.safeParse(value ?? undefined);
  return result.success ? result.data : fallback;
}

/** Narrow an unknown jsonb value to an object, with a fallback. */
export function asObject<T extends Record<string, unknown>>(
  value: unknown,
  fallback: T,
): T {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as T)
    : fallback;
}

/** Narrow an unknown jsonb value to an array, with a fallback. */
export function asArray<T>(value: unknown, fallback: T[] = []): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback;
}
