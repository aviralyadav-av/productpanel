"use client";

import * as React from "react";
import { KeyRound, Loader2, ShieldAlert, Users } from "lucide-react";
import { toast } from "sonner";

import { Panel } from "@/components/shared/panel";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill } from "@/components/shared/status-badge";
import {
  DataTable,
  DataTableBody,
  DataTableHead,
  Td,
  Th,
  Tr,
} from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatIstDateTime } from "@/lib/dates";
import { changePassword, updateAdminProfile } from "../actions";
import { MIN_PASSWORD_LENGTH } from "../schemas";
import type {
  AccountOverview,
  AdminAccountRow,
  LoginAttemptRow,
} from "../queries";

/**
 * The operator's own account, plus enough visibility to notice someone else
 * trying to get into it. There is deliberately no user management here: the
 * store has exactly two roles and one operator, and a create-user form would
 * be more attack surface than convenience.
 */
export function AccountTab({
  overview,
  lockout,
}: {
  overview: AccountOverview;
  lockout: { attempts: number; windowMinutes: number };
}) {
  return (
    <div className="grid items-start gap-3 xl:grid-cols-2">
      <div className="space-y-3">
        <ProfileForm
          // Reset the form to server truth once a save has landed.
          key={`${overview.user.email}:${overview.user.name ?? ""}`}
          user={overview.user}
        />
        <PasswordForm />
      </div>

      <div className="space-y-3">
        <SignInActivity
          user={overview.user}
          attempts={overview.attempts}
          recentFailures={overview.recentFailures}
          lockout={lockout}
        />
        <OtherAdmins admins={overview.otherAdmins} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function ProfileForm({ user }: { user: AccountOverview["user"] }) {
  const [name, setName] = React.useState(user.name ?? "");
  const [email, setEmail] = React.useState(user.email);
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, startTransition] = React.useTransition();

  const emailChanged = email.trim().toLowerCase() !== user.email;
  const dirty = emailChanged || name.trim() !== (user.name ?? "").trim();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    startTransition(async () => {
      const result = await updateAdminProfile({
        name,
        email,
        currentPassword: emailChanged ? currentPassword : undefined,
      });

      if (result.ok) {
        setErrors({});
        setCurrentPassword("");
        toast.success(result.message ?? "Profile saved.");
        return;
      }

      setErrors(result.fieldErrors ?? {});
      toast.error(result.error);
    });
  }

  return (
    <Panel title="Profile" bodyClassName="p-0">
      <form onSubmit={handleSubmit}>
        <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-4 py-2.5 text-[11px]">
          <div className="flex items-center gap-1.5">
            <dt className="text-muted-foreground">Role</dt>
            <dd>
              <StatusPill
                label={user.role === "ADMIN" ? "Admin" : user.role}
                tone={user.role === "ADMIN" ? "brand" : "neutral"}
              />
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-muted-foreground">Account</dt>
            <dd>
              <StatusPill
                label={user.isActive ? "Active" : "Disabled"}
                tone={user.isActive ? "success" : "danger"}
              />
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-muted-foreground">Created</dt>
            <dd data-numeric>{formatIstDateTime(user.createdAt)}</dd>
          </div>
        </dl>

        <div className="space-y-3 p-4">
          <Field
            id="account-name"
            label="Name"
            error={errors.name}
            hint="Shown in the header menu and against every entry you leave in the activity log."
          >
            <Input
              id="account-name"
              value={name}
              disabled={pending}
              autoComplete="name"
              aria-invalid={Boolean(errors.name)}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          <Field
            id="account-email"
            label="Sign-in email"
            error={errors.email}
            hint="Your session survives an email change: the token stores your user id, not your address."
          >
            <Input
              id="account-email"
              type="email"
              value={email}
              disabled={pending}
              autoComplete="username"
              aria-invalid={Boolean(errors.email)}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          {emailChanged ? (
            <Field
              id="account-current-password"
              label="Current password"
              error={errors.currentPassword}
              hint="Required because you are changing the address you sign in with."
            >
              <Input
                id="account-current-password"
                type="password"
                value={currentPassword}
                disabled={pending}
                autoComplete="current-password"
                aria-invalid={Boolean(errors.currentPassword)}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </Field>
          ) : null}
        </div>

        <div className="bg-muted/30 flex items-center justify-end border-t px-4 py-2">
          <Button type="submit" size="sm" disabled={!dirty || pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Save profile
          </Button>
        </div>
      </form>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

function PasswordForm() {
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, startTransition] = React.useTransition();

  const filled =
    currentPassword.length > 0 &&
    newPassword.length > 0 &&
    confirmPassword.length > 0;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    startTransition(async () => {
      const result = await changePassword({
        currentPassword,
        newPassword,
        confirmPassword,
      });

      if (result.ok) {
        setErrors({});
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        toast.success(result.message ?? "Password changed.");
        return;
      }

      setErrors(result.fieldErrors ?? {});
      toast.error(result.error);
    });
  }

  return (
    <Panel title="Password" bodyClassName="p-0">
      <form onSubmit={handleSubmit}>
        <p className="text-muted-foreground border-b px-4 py-2 text-[11px] leading-relaxed">
          Hashed with bcrypt at 12 rounds, the same cost the login provider
          verifies against. Sessions are signed tokens with no server-side
          store, so changing this does not sign other browsers out — they run
          out at the eight-hour session limit.
        </p>

        <div className="space-y-3 p-4">
          <Field
            id="password-current"
            label="Current password"
            error={errors.currentPassword}
          >
            <Input
              id="password-current"
              type="password"
              value={currentPassword}
              disabled={pending}
              autoComplete="current-password"
              aria-invalid={Boolean(errors.currentPassword)}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </Field>

          <Field
            id="password-new"
            label="New password"
            error={errors.newPassword}
            hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          >
            <Input
              id="password-new"
              type="password"
              value={newPassword}
              disabled={pending}
              autoComplete="new-password"
              aria-invalid={Boolean(errors.newPassword)}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Field>

          <Field
            id="password-confirm"
            label="Repeat new password"
            error={
              errors.confirmPassword ??
              (confirmPassword.length > 0 && confirmPassword !== newPassword
                ? "These do not match."
                : undefined)
            }
          >
            <Input
              id="password-confirm"
              type="password"
              value={confirmPassword}
              disabled={pending}
              autoComplete="new-password"
              aria-invalid={Boolean(errors.confirmPassword)}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </Field>
        </div>

        <div className="bg-muted/30 flex items-center justify-end border-t px-4 py-2">
          <Button type="submit" size="sm" disabled={!filled || pending}>
            {pending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <KeyRound className="size-3.5" />
            )}
            Change password
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {children}
      {error ? (
        <p className="text-destructive text-[11px]">{error}</p>
      ) : hint ? (
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sign-in activity
// ---------------------------------------------------------------------------

function SignInActivity({
  user,
  attempts,
  recentFailures,
  lockout,
}: {
  user: AccountOverview["user"];
  attempts: LoginAttemptRow[];
  recentFailures: number;
  lockout: { attempts: number; windowMinutes: number };
}) {
  return (
    <Panel
      title="Sign-in activity"
      description={
        user.lastLoginAt
          ? `Last successful sign-in ${formatIstDateTime(user.lastLoginAt)}`
          : "No successful sign-in recorded yet"
      }
      bodyClassName="p-0"
    >
      {recentFailures > 0 ? (
        <p className="border-warning/30 bg-warning-muted/50 flex items-start gap-2 border-b px-4 py-2 text-[11px] leading-relaxed">
          <ShieldAlert className="text-warning mt-px size-3.5 shrink-0" />
          <span>
            <span className="font-medium">
              {recentFailures} failed attempt
              {recentFailures === 1 ? "" : "s"}
            </span>{" "}
            for this email in the last {lockout.windowMinutes} minutes.{" "}
            {lockout.attempts} within the window blocks sign-in until the window
            passes.
          </span>
        </p>
      ) : null}

      {attempts.length === 0 ? (
        <EmptyState
          compact
          title="No attempts recorded"
          description="Every sign-in attempt for this email is written to LoginAttempt, successful or not."
        />
      ) : (
        <DataTable>
          <DataTableHead>
            <Th>Time (IST)</Th>
            <Th>Result</Th>
            <Th>IP</Th>
          </DataTableHead>
          <DataTableBody>
            {attempts.map((attempt) => (
              <Tr key={attempt.id}>
                <Td numeric>{formatIstDateTime(attempt.createdAt)}</Td>
                <Td>
                  <StatusPill
                    label={attempt.success ? "Success" : "Failed"}
                    tone={attempt.success ? "success" : "danger"}
                  />
                </Td>
                <Td className="text-muted-foreground font-mono text-[11px]">
                  {/* Null for anything the Credentials provider records, which
                      does not see the request headers. */}
                  {attempt.ip ?? "not recorded"}
                </Td>
              </Tr>
            ))}
          </DataTableBody>
        </DataTable>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Other admins
// ---------------------------------------------------------------------------

function OtherAdmins({ admins }: { admins: AdminAccountRow[] }) {
  return (
    <Panel title="Other admin accounts" bodyClassName="p-0">
      <p className="text-muted-foreground border-b px-4 py-2 text-[11px] leading-relaxed">
        Read-only. There are exactly two roles, ADMIN and USER, and accounts are
        created by the seeder or directly in the database — this panel has no
        user management by design.
      </p>

      {admins.length === 0 ? (
        <EmptyState
          compact
          icon={Users}
          title="Yours is the only admin account"
          description="If you lose access to it, nobody can restore it from inside the panel."
        />
      ) : (
        <DataTable>
          <DataTableHead>
            <Th>Account</Th>
            <Th>Role</Th>
            <Th>State</Th>
            <Th>Last sign-in</Th>
          </DataTableHead>
          <DataTableBody>
            {admins.map((admin) => (
              <Tr key={admin.id}>
                <Td>
                  <span className="font-medium">{admin.name ?? "Unnamed"}</span>
                  <span className="text-muted-foreground block text-[11px]">
                    {admin.email}
                  </span>
                </Td>
                <Td>
                  <StatusPill label="Admin" tone="brand" />
                </Td>
                <Td>
                  <StatusPill
                    label={admin.isActive ? "Active" : "Disabled"}
                    tone={admin.isActive ? "success" : "danger"}
                  />
                </Td>
                <Td numeric className="text-muted-foreground">
                  {admin.lastLoginAt
                    ? formatIstDateTime(admin.lastLoginAt)
                    : "never"}
                </Td>
              </Tr>
            ))}
          </DataTableBody>
        </DataTable>
      )}
    </Panel>
  );
}
