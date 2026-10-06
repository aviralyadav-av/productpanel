"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { FormActions } from "@/components/shared/form-actions";
import { FormRow, FormSection } from "@/components/shared/form-layout";
import { useActionToast } from "@/components/shared/use-action-toast";

import {
  disableUserTwoFactorAction,
  sendUserResetLinkAction,
  setForcePasswordChangeAction,
  setUserRoleAction,
  setUserStatusAction,
  updateUserAction,
} from "@/features/users/actions";
import type { RoleOption, UserDetail, UserPermissions } from "@/features/users/schemas";

/**
 * The profile and access cards of /admin/users/[id].
 *
 * Every control is enabled from `permissions`, which the SERVER computed with
 * the same D3 rules the service enforces - the UI never decides for itself
 * whether an action is allowed, it only renders the answer (and the reason,
 * when there is one).
 */
export function UserProfileCard({
  user,
  permissions,
}: {
  user: UserDetail;
  permissions: UserPermissions;
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [name, setName] = React.useState(user.name ?? "");
  const [email, setEmail] = React.useState(user.email);
  const [phone, setPhone] = React.useState(user.phone ?? "");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const dirty =
    name !== (user.name ?? "") || email !== user.email || phone !== (user.phone ?? "");
  const emailChanged = email !== user.email;

  async function save() {
    const result = await run(() => updateUserAction(user.id, { name, email, phone }), {
      onSuccess: () => {
        setErrors({});
        router.refresh();
      },
    });
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <FormSection
        title="Profile"
        description="Name and email as they appear in the audit log and on every record this person touches."
      >
        <FormRow label="Name" htmlFor="user-name" required error={errors.name}>
          <Input
            id="user-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={!permissions.canEdit || pending}
          />
        </FormRow>

        <FormRow
          label="Email"
          htmlFor="user-email"
          required
          error={errors.email}
          hint={
            emailChanged && !permissions.isSelf
              ? "Changing the email signs this person out of every device."
              : "Also their sign-in name."
          }
        >
          <Input
            id="user-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={!permissions.canEdit || pending}
          />
        </FormRow>

        <FormRow label="Phone" htmlFor="user-phone" error={errors.phone} hint="Optional.">
          <Input
            id="user-phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            disabled={!permissions.canEdit || pending}
            placeholder="+91…"
          />
        </FormRow>

        {permissions.canEdit ? (
          <FormActions
            dirty={dirty}
            pending={pending}
            disabled={!dirty}
            submitLabel="Save profile"
            onCancel={() => {
              setName(user.name ?? "");
              setEmail(user.email);
              setPhone(user.phone ?? "");
              setErrors({});
            }}
          />
        ) : (
          <p className="text-muted-foreground text-xs">
            {permissions.reason ?? "You have read-only access to this account."}
          </p>
        )}
      </FormSection>
    </form>
  );
}

export function UserAccessCard({
  user,
  permissions,
  roles,
}: {
  user: UserDetail;
  permissions: UserPermissions;
  roles: RoleOption[];
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const [roleId, setRoleId] = React.useState(user.roleId ?? "");

  const currentRole = roles.find((role) => role.id === user.roleId);

  async function saveRole() {
    if (!roleId || roleId === user.roleId) return;
    const next = roles.find((role) => role.id === roleId);
    const result = await confirm({
      title: `Move ${user.email} to ${next?.name ?? "another role"}?`,
      description:
        "Their permissions change on their next request - open sessions are not signed out. Role changes are audited.",
      confirmLabel: "Change role",
    });
    if (!result.ok) return;
    await run(() => setUserRoleAction(user.id, { roleId }), {
      onSuccess: () => router.refresh(),
    });
  }

  async function toggleActive(next: boolean) {
    const result = await confirm({
      title: next ? `Reactivate ${user.email}?` : `Deactivate ${user.email}?`,
      description: next
        ? "They can sign in again immediately."
        : "They are signed out of every device and cannot sign in until reactivated.",
      confirmLabel: next ? "Reactivate" : "Deactivate",
      destructive: !next,
      requireReason: next ? undefined : { label: "Reason (recorded in the audit log)" },
    });
    if (!result.ok) return;
    await run(
      () => setUserStatusAction(user.id, { isActive: next, reason: result.reason ?? null }),
      { onSuccess: () => router.refresh() },
    );
  }

  async function toggleForceChange(next: boolean) {
    await run(() => setForcePasswordChangeAction(user.id, { forcePasswordChange: next }), {
      onSuccess: () => router.refresh(),
    });
  }

  async function sendReset() {
    const result = await confirm({
      title: `Email a reset link to ${user.email}?`,
      description:
        "The link is single-use and expires in 30 minutes. Completing it signs them out everywhere. You never see the password.",
      confirmLabel: "Send link",
    });
    if (!result.ok) return;
    await run(() => sendUserResetLinkAction(user.id));
  }

  async function disableTwoFactor() {
    const result = await confirm({
      title: `Turn off two-factor login for ${user.email}?`,
      description:
        "Break-glass only, for a lost authenticator. Their sessions are signed out and the action is recorded against your name.",
      confirmLabel: "Turn off 2FA",
      destructive: true,
      requireReason: { label: "Why is this needed?", placeholder: "e.g. lost phone, verified by video call" },
    });
    if (!result.ok) return;
    await run(() => disableUserTwoFactorAction(user.id, result.reason ?? undefined), {
      onSuccess: () => router.refresh(),
    });
  }

  return (
    <FormSection
      title="Access"
      description="Role, sign-in status and password. An admin can trigger a reset link but never choose somebody else's password."
    >
      <FormRow
        label="Role"
        hint={
          permissions.canChangeRole
            ? (roles.find((role) => role.id === roleId)?.reason ??
              `${currentRole?.permissionCount ?? 0} permissions today.`)
            : (permissions.reason ??
              "You cannot change this role - your own role, the last super-admin, or a role above yours.")
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={roleId}
            onValueChange={setRoleId}
            disabled={!permissions.canChangeRole || pending}
          >
            <SelectTrigger aria-label="Role" className="w-56">
              <SelectValue placeholder="No role" />
            </SelectTrigger>
            <SelectContent>
              {roles.map((role) => (
                <SelectItem key={role.id} value={role.id} disabled={!role.assignable}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {permissions.canChangeRole && roleId !== user.roleId ? (
            <Button type="button" size="sm" disabled={pending} onClick={saveRole}>
              Apply
            </Button>
          ) : null}
        </div>
      </FormRow>

      <FormRow
        label="Active"
        htmlFor="user-active"
        inline
        hint={
          user.deletedAt
            ? "This account was deactivated and cannot be re-enabled here."
            : "Inactive accounts cannot sign in; their history stays intact."
        }
      >
        <Switch
          id="user-active"
          checked={user.isActive}
          onCheckedChange={toggleActive}
          disabled={!permissions.canChangeStatus || pending || Boolean(user.deletedAt)}
        />
      </FormRow>

      <FormRow
        label="Force password change"
        htmlFor="user-force-change"
        inline
        hint="They must choose a new password before they can use the admin again."
      >
        <Switch
          id="user-force-change"
          checked={user.forcePasswordChange}
          onCheckedChange={toggleForceChange}
          disabled={!permissions.canEdit || pending}
        />
      </FormRow>

      <FormRow
        label="Two-factor login"
        inline
        hint={
          user.twoFactorEnabled
            ? "Enabled. Only a super-admin can remove it for somebody else."
            : "Not enabled. Only the account holder can turn it on, from their own Security page."
        }
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{user.twoFactorEnabled ? "On" : "Off"}</span>
          {user.twoFactorEnabled && permissions.canDisableTwoFactor ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={pending}
              onClick={disableTwoFactor}
            >
              <ShieldOff className="size-3.5" />
              Disable 2FA
            </Button>
          ) : null}
        </div>
      </FormRow>

      <FormRow
        label="Password"
        inline
        hint="Sends the same reset email the forgot-password form does."
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!permissions.canResetPassword || pending}
          onClick={sendReset}
        >
          <KeyRound className="size-3.5" />
          Send password reset link
        </Button>
      </FormRow>

      {confirmDialog}
    </FormSection>
  );
}
