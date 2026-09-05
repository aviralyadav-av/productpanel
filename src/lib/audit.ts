import "server-only";

import { headers } from "next/headers";
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/guards";

/**
 * Append-only audit trail. There is no update or delete path for these rows,
 * by design - an audit log an admin can edit is not an audit log.
 *
 * Failures are swallowed on purpose: losing an audit row must never roll back
 * the business change the operator actually asked for. If audit writes start
 * failing, that shows up in the error logs, not as a broken save button.
 */
const REDACTED_KEYS = new Set([
  "passwordHash",
  "password",
  "token",
  "secret",
  "AUTH_SECRET",
]);

function redact(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = REDACTED_KEYS.has(key) ? "[redacted]" : redact(item);
  }
  return output;
}

/** Only the fields that actually changed, so diffs stay readable. */
export function diffOf(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Prisma.InputJsonValue | undefined {
  if (!before || !after) {
    return (redact(after ?? before) ?? undefined) as Prisma.InputJsonValue;
  }

  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const from = before[key];
    const to = after[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changed[key] = { from: redact(from), to: redact(to) };
    }
  }

  if (Object.keys(changed).length === 0) return undefined;
  return changed as Prisma.InputJsonValue;
}

export async function writeAudit(input: {
  actor: Actor;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  diff?: Prisma.InputJsonValue;
}): Promise<void> {
  try {
    const headerList = await headers();

    await db.auditLog.create({
      data: {
        actorId: input.actor.id,
        actorEmail: input.actor.email,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary,
        diff: input.diff,
        ip:
          headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          headerList.get("x-real-ip"),
        userAgent: headerList.get("user-agent"),
      },
    });
  } catch (error) {
    console.error("AUDIT WRITE FAILED", input.action, error);
  }
}
