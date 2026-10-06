import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/guards";

/**
 * Append-only audit trail (blueprint §14.D13). There is no update or delete
 * path for these rows, by design - an audit log an admin can edit is not an
 * audit log - and the migration installs a trigger that enforces it.
 *
 * Two calling styles, deliberately different in failure semantics:
 *
 *   writeAudit({ actor, action, ... })        - best-effort. Losing an audit
 *     row must never roll back the business change the operator asked for, so
 *     failures are logged and swallowed.
 *   writeAudit(tx, { actor, action, ... })    - part of the caller's
 *     transaction. Used for financial and security actions and by jobs: if
 *     the audit row cannot be written the whole change aborts (D13).
 *
 * This module is imported by the job worker and the break-glass scripts as
 * plain `tsx` processes, which is why it does NOT import `server-only` or
 * `next/headers` statically: request headers are read through a guarded
 * dynamic import that is a no-op outside the Next runtime. Callers that know
 * the client (route handlers, webhooks) pass `ip`/`userAgent` explicitly.
 */

/**
 * The actor jobs, cron and webhooks write audit rows as. The seed creates an
 * inactive User with this id so `AuditLog.actorId` stays a real foreign key;
 * `isSuperAdmin` is true so service-level `can()` checks pass for
 * system-driven flows (a job settling a payment is not "unauthorised").
 */
export const SYSTEM_ACTOR: Actor = {
  id: "system",
  email: "system@diybaazar.local",
  name: "System",
  image: null,
  roleId: null,
  roleSlug: "super-admin",
  roleName: "System",
  permissions: new Set<string>(),
  isSuperAdmin: true,
  // Not a real AdminSession: jobs and webhooks have no login. A non-empty
  // sentinel keeps the Actor shape intact for any code that logs it.
  sessionId: "system",
  pendingMfa: false,
  twoFactorEnabled: false,
  forcePasswordChange: false,
};

/** The minimum an audit row needs; a full Actor always satisfies it. */
export type AuditActor = Pick<Actor, "id" | "email">;

export type AuditInput = {
  actor: AuditActor;
  /** e.g. product.update, order.status_change, settings.update */
  action: string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  summary: string;
  diff?: Prisma.InputJsonValue;
  /** Explicit client details; when omitted the request headers are consulted. */
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Keys whose values never land in a diff (D4 `redact()`): credentials, hashes,
 * tokens, encrypted blobs and bank numbers. Matched case-insensitively by
 * substring/suffix so `smtpPassword`, `credentialsEnc` and `accountNumber`
 * are all caught without an ever-growing literal list.
 */
const REDACT_PATTERN = /(password|secret|token|hash|credential|Enc$|accountNumber)/i;

function shouldRedact(key: string): boolean {
  return REDACT_PATTERN.test(key) || key === "AUTH_SECRET";
}

function redact(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = shouldRedact(key) ? "[redacted]" : redact(item);
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

/** True only inside the Next.js server runtime, where `next/headers` is usable. */
function insideNext(): boolean {
  return typeof process !== "undefined" && Boolean(process.env.NEXT_RUNTIME);
}

/**
 * Client details from the current request, if there is one. Outside a request
 * scope (worker, scripts, `after()` callbacks) `headers()` throws; that is
 * expected and yields nulls rather than failing the audit write.
 */
async function requestClient(): Promise<{ ip: string | null; userAgent: string | null }> {
  if (!insideNext()) return { ip: null, userAgent: null };
  try {
    const { headers } = await import("next/headers");
    const headerList = await headers();
    return {
      ip:
        headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        headerList.get("x-real-ip") ??
        null,
      userAgent: headerList.get("user-agent"),
    };
  } catch {
    return { ip: null, userAgent: null };
  }
}

async function insertAudit(
  client: Prisma.TransactionClient | typeof db,
  input: AuditInput,
): Promise<void> {
  const fromRequest =
    input.ip === undefined && input.userAgent === undefined
      ? await requestClient()
      : { ip: null, userAgent: null };

  await client.auditLog.create({
    data: {
      actorId: input.actor.id,
      actorEmail: input.actor.email,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      entityLabel: input.entityLabel ?? null,
      summary: input.summary,
      diff: input.diff,
      ip: input.ip ?? fromRequest.ip,
      userAgent: input.userAgent ?? fromRequest.userAgent,
    },
  });
}

export async function writeAudit(input: AuditInput): Promise<void>;
export async function writeAudit(tx: Prisma.TransactionClient, input: AuditInput): Promise<void>;
export async function writeAudit(
  first: Prisma.TransactionClient | AuditInput,
  second?: AuditInput,
): Promise<void> {
  // Two-argument form: inside the caller's transaction, failures propagate.
  if (second) {
    await insertAudit(first as Prisma.TransactionClient, second);
    return;
  }

  const input = first as AuditInput;
  try {
    await insertAudit(db, input);
  } catch (error) {
    console.error("AUDIT WRITE FAILED", input.action, error);
  }
}
