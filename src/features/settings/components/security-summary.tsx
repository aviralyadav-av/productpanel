import Link from "next/link";
import type { Route } from "next";
import { ShieldCheck } from "lucide-react";

import { PASSWORD_MIN_LENGTH } from "@/features/account/password-policy";
import { RESET_TOKEN_TTL_MINUTES } from "@/features/account/password-reset";

import type { SecuritySummary } from "@/features/settings/queries";

/**
 * The read-only half of the Security tab (§14.D9, D10).
 *
 * The three editable keys above it are only meaningful next to the policy they
 * sit in - "idle timeout 60 minutes" reads differently when you can also see
 * that 41 sessions are live and two super-admins have no second factor. The
 * fixed rules are stated rather than made configurable because they are
 * enforced in code (login backoff, token TTL, password length).
 */
export function SecuritySummaryPanel({ summary }: { summary: SecuritySummary }) {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Live admin sessions", value: String(summary.activeSessions) },
    {
      label: "Admins with 2FA",
      value: `${summary.adminsWithTwoFactor} of ${summary.activeAdmins} active`,
    },
    { label: "Active super-admins", value: String(summary.superAdmins) },
    { label: "Failed sign-ins (24 h)", value: String(summary.failedLogins24h) },
    { label: "Session lifetime", value: `${summary.sessionHours} hours (absolute)` },
    { label: "Idle timeout", value: `${summary.idleMinutes} minutes` },
    {
      label: "2FA required for super-admins",
      value: summary.require2faForSuperAdmin ? "Yes" : "No",
    },
  ];

  return (
    <section className="surface space-y-3 p-4">
      <header className="flex items-center gap-2">
        <ShieldCheck className="text-muted-foreground size-4" />
        <h2 className="text-sm font-semibold tracking-tight">Login policy</h2>
      </header>

      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3 border-b pb-1">
            <dt className="text-muted-foreground text-xs">{row.label}</dt>
            <dd data-numeric className="text-xs font-medium">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <ul className="text-muted-foreground list-disc space-y-1 pl-4 text-[11px] leading-relaxed">
        <li>
          Sign-in is rate limited 30 attempts per 15 minutes per IP, then backed off per email
          (1 s rising to 15 minutes) instead of locking the account out.
        </li>
        <li>
          Password resets are single-use, hashed at rest and expire after {RESET_TOKEN_TTL_MINUTES}{" "}
          minutes; completing one revokes every session of that user. Minimum password length is{" "}
          {PASSWORD_MIN_LENGTH} characters.
        </li>
        <li>
          Revoking a session takes effect on the next request - every guard re-reads the session
          row rather than trusting the cookie.
        </li>
        <li>
          Manage your own second factor on{" "}
          <Link href={"/admin/account/security" as Route} className="underline underline-offset-2">
            your account
          </Link>
          ; break-glass recovery for somebody else lives on their user page.
        </li>
      </ul>
    </section>
  );
}
