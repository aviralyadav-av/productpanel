"use client";

import { useRouter } from "next/navigation";
import { UserMinus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { useActionToast } from "@/components/shared/use-action-toast";

import { deactivateUserAction } from "@/features/users/actions";
import type { UserDetail, UserPermissions } from "@/features/users/schemas";

/**
 * The danger zone of /admin/users/[id].
 *
 * "Delete" is a soft delete and the copy says so: the row survives because
 * AuditLog, orders, products and a dozen other tables point at it, and an
 * admin's history must stay attributable after they leave (D3).
 */
export function UserDangerZone({
  user,
  permissions,
}: {
  user: UserDetail;
  permissions: UserPermissions;
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();

  if (user.deletedAt) {
    return (
      <section className="surface border-destructive/40 space-y-1 p-4">
        <h2 className="text-sm font-semibold tracking-tight">Deactivated account</h2>
        <p className="text-muted-foreground text-xs leading-relaxed">
          This account was deactivated and its email rewritten to{" "}
          <code>{user.email}</code>. It is kept so past actions stay attributable; it cannot sign
          in and cannot be restored from here.
        </p>
      </section>
    );
  }

  async function remove() {
    const result = await confirm({
      title: `Deactivate ${user.email}?`,
      description:
        "They are signed out everywhere, their email is released, and they can never sign in again. Their audit history and the records they created stay intact. This cannot be undone from the admin.",
      confirmLabel: "Deactivate account",
      destructive: true,
      requireTypedText: user.email,
      requireReason: { label: "Reason (recorded in the audit log)" },
    });
    if (!result.ok) return;
    await run(() => deactivateUserAction(user.id, { reason: result.reason ?? null }), {
      onSuccess: () => {
        router.push("/admin/users");
        router.refresh();
      },
    });
  }

  return (
    <section className="surface border-destructive/40 space-y-3 p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold tracking-tight">Danger zone</h2>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Deactivating releases the email address for reuse and revokes every session. Admin users
          are never hard-deleted - too much history points at them.
        </p>
      </div>
      <Button
        variant="destructive"
        size="sm"
        disabled={!permissions.canDelete || pending}
        onClick={remove}
      >
        <UserMinus className="size-3.5" />
        Deactivate account
      </Button>
      {!permissions.canDelete ? (
        <p className="text-muted-foreground text-[11px]">
          {permissions.reason ??
            "You cannot deactivate this account - it is yours, the last super-admin, or above your reach."}
        </p>
      ) : null}
      {confirmDialog}
    </section>
  );
}
