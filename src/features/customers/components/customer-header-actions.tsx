"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Ban, KeyRound, Pencil, ShieldCheck, Trash2 } from "lucide-react";

import { useConfirm } from "@/components/shared/confirm-dialog";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Button } from "@/components/ui/button";

import { deleteCustomerAction, sendPasswordResetAction, setCustomerStatusAction } from "@/features/customers/actions";

/**
 * Header buttons on /admin/customers/[id]: Edit, Block/Unblock (with reason),
 * Send password reset, Delete (soft). Each destructive one confirms first;
 * the reason lands in the audit row (D13).
 */
export function CustomerHeaderActions({
  customer,
  permissions,
}: {
  customer: { id: string; email: string; fullName: string | null; status: string; deletedAt: Date | null };
  permissions: string[];
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const permitted = new Set(permissions);
  const can = (code: string) => permitted.has("*") || permitted.has(code);
  const name = customer.fullName ?? customer.email;

  if (customer.deletedAt) return null;

  const toggleBlock = async () => {
    if (customer.status === "BLOCKED") {
      await run(() => setCustomerStatusAction(customer.id, "ACTIVE"), { onSuccess: () => router.refresh() });
      return;
    }
    const answer = await confirm({
      title: "Block customer",
      description: `Block ${name}? Every website session is revoked and they cannot place orders until unblocked.`,
      destructive: true,
      confirmLabel: "Block",
      requireReason: { label: "Reason", placeholder: "Why is this customer being blocked?" },
    });
    if (!answer.ok) return;
    await run(() => setCustomerStatusAction(customer.id, "BLOCKED", answer.reason), { onSuccess: () => router.refresh() });
  };

  const resetPassword = async () => {
    const answer = await confirm({ title: "Send password reset", description: `Email ${customer.email} a link to choose a new password? It expires in 60 minutes and any older link stops working.`, confirmLabel: "Send link" });
    if (!answer.ok) return;
    await run(() => sendPasswordResetAction(customer.id), { onSuccess: () => router.refresh() });
  };

  const remove = async () => {
    const answer = await confirm({
      title: "Delete customer",
      description: `Delete ${name}? The email becomes a placeholder, addresses, wishlist, carts and sessions are removed; orders and reviews keep their history. This cannot be undone.`,
      destructive: true,
      confirmLabel: "Delete",
      requireTypedText: customer.email,
      requireReason: { label: "Reason", placeholder: "GDPR request, duplicate account…" },
    });
    if (!answer.ok) return;
    await run(() => deleteCustomerAction(customer.id, answer.reason), { onSuccess: () => router.push("/admin/customers" as Route) });
  };

  return (
    <>
      {can("customers.edit") ? (
        <Button asChild variant="outline" size="sm">
          <Link href={`/admin/customers/${customer.id}?tab=profile` as Route}>
            <Pencil /> Edit
          </Link>
        </Button>
      ) : null}
      {can("customers.reset_password") && customer.status !== "BLOCKED" ? (
        <Button variant="outline" size="sm" onClick={() => void resetPassword()} disabled={pending}>
          <KeyRound /> Send password reset
        </Button>
      ) : null}
      {can("customers.block") ? (
        <Button variant={customer.status === "BLOCKED" ? "outline" : "destructive"} size="sm" onClick={() => void toggleBlock()} disabled={pending}>
          {customer.status === "BLOCKED" ? (
            <>
              <ShieldCheck /> Unblock
            </>
          ) : (
            <>
              <Ban /> Block
            </>
          )}
        </Button>
      ) : null}
      {can("customers.delete") ? (
        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void remove()} disabled={pending}>
          <Trash2 /> Delete
        </Button>
      ) : null}
      {confirmDialog}
    </>
  );
}

/** The Danger zone tab body: the same soft delete, spelled out. */
export function DangerZone({ customer, canDelete }: { customer: { id: string; email: string; fullName: string | null; deletedAt: Date | null }; canDelete: boolean }) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();

  const remove = async () => {
    const answer = await confirm({
      title: "Delete customer",
      description: "Type the email address to confirm. Orders, reviews and returns keep their snapshots; everything personal is removed or anonymised.",
      destructive: true,
      confirmLabel: "Delete customer",
      requireTypedText: customer.email,
      requireReason: { label: "Reason" },
    });
    if (!answer.ok) return;
    await run(() => deleteCustomerAction(customer.id, answer.reason), { onSuccess: () => router.push("/admin/customers" as Route) });
  };

  return (
    <div className="surface border-destructive/40 space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">Delete this customer</h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-xs leading-relaxed">
          Soft delete (blueprint E7): the email becomes <code className="font-mono">deleted+{customer.id}@invalid.local</code> with the original kept only as a hash,
          the phone and password are cleared, website sessions are revoked, and addresses, wishlist and carts are removed. Order history is preserved
          unchanged. Customers with open orders cannot be deleted.
        </p>
      </div>
      {customer.deletedAt ? (
        <p className="text-muted-foreground text-xs">This customer was deleted on {customer.deletedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}.</p>
      ) : canDelete ? (
        <Button variant="destructive" size="sm" onClick={() => void remove()} disabled={pending}>
          <Trash2 /> Delete customer
        </Button>
      ) : (
        <p className="text-muted-foreground text-xs">You need the customers.delete permission to do this.</p>
      )}
      {confirmDialog}
    </div>
  );
}
