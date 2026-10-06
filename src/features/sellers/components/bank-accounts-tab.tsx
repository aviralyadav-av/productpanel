"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Eye, Landmark, Pencil, Plus, Star, Trash2 } from "lucide-react";

import { formatIstDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { CopyButton } from "@/components/shared/copy-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PermissionGate } from "@/components/shared/permission-gate";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";

import {
  addBankAccountAction,
  deleteBankAccountAction,
  revealBankAccountAction,
  setPrimaryBankAccountAction,
  updateBankAccountAction,
  verifyBankAccountAction,
} from "@/features/sellers/actions";
import type { RevealedBankAccount } from "@/features/sellers/service";
import type { SellerBankAccountRow } from "@/features/sellers/types";

/**
 * Bank accounts tab (D4). The list is masked; the full number appears only
 * after "Reveal", which needs payouts.process, is audited server-side and is
 * shown for 30 seconds in a dialog rather than written into the table.
 */
export function BankAccountsTab({ sellerId, rows }: { sellerId: string; rows: SellerBankAccountRow[] }) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const [editing, setEditing] = React.useState<SellerBankAccountRow | "new" | null>(null);
  const [revealed, setRevealed] = React.useState<RevealedBankAccount | null>(null);

  const refresh = () => router.refresh();

  async function remove(row: SellerBankAccountRow) {
    const result = await confirm({
      title: `Delete ${row.bankName} account ending ${row.accountNumberLast4}?`,
      description: row.isPrimary ? "This is the primary payout account; the oldest remaining account becomes primary." : undefined,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!result.ok) return;
    await run(() => deleteBankAccountAction(sellerId, row.id), { onSuccess: refresh });
  }

  async function reveal(row: SellerBankAccountRow) {
    await run(() => revealBankAccountAction(sellerId, row.id), { silent: true, onSuccess: (data) => setRevealed(data) });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          Account numbers are encrypted at rest; only the last four digits are listed. Payouts go to the primary account.
        </p>
        <PermissionGate require="sellers.edit">
          <Button type="button" size="sm" onClick={() => setEditing("new")}>
            <Plus />
            Add account
          </Button>
        </PermissionGate>
      </div>

      {rows.length === 0 ? (
        <div className="surface">
          <EmptyState icon={Landmark} title="No bank account" description="A primary bank account is required before the seller can be activated or paid." />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((row) => (
            <div key={row.id} className="surface space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.bankName}</p>
                  <p className="text-muted-foreground truncate text-xs">{row.accountHolder}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {row.isPrimary ? <StatusPill label="Primary" tone="brand" /> : null}
                  <StatusPill label={row.isVerified ? "Verified" : "Unverified"} tone={row.isVerified ? "success" : "warning"} />
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Account</dt>
                <dd data-numeric className="font-mono">
                  •••• {row.accountNumberLast4}
                </dd>
                <dt className="text-muted-foreground">IFSC</dt>
                <dd className="font-mono">{row.ifsc}</dd>
                <dt className="text-muted-foreground">UPI</dt>
                <dd className="truncate font-mono">{row.upiId ?? "—"}</dd>
                <dt className="text-muted-foreground">Added</dt>
                <dd data-numeric>{formatIstDate(new Date(row.createdAt))}</dd>
              </dl>
              <div className="flex flex-wrap items-center gap-1 border-t pt-3">
                <PermissionGate require="payouts.process">
                  <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => void reveal(row)}>
                    <Eye />
                    Reveal
                  </Button>
                </PermissionGate>
                <PermissionGate require="sellers.edit">
                  {!row.isPrimary ? (
                    <Button type="button" size="xs" variant="ghost" disabled={pending} onClick={() => void run(() => setPrimaryBankAccountAction(sellerId, row.id), { onSuccess: refresh })}>
                      <Star />
                      Set primary
                    </Button>
                  ) : null}
                  <Button type="button" size="xs" variant="ghost" disabled={pending} onClick={() => setEditing(row)}>
                    <Pencil />
                    Edit
                  </Button>
                </PermissionGate>
                <PermissionGate require="sellers.approve">
                  {!row.isVerified ? (
                    <Button type="button" size="xs" variant="ghost" disabled={pending} onClick={() => void run(() => verifyBankAccountAction(sellerId, row.id), { onSuccess: refresh })}>
                      <BadgeCheck />
                      Verify
                    </Button>
                  ) : null}
                </PermissionGate>
                <PermissionGate require="sellers.edit">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="text-destructive ml-auto"
                    disabled={pending || row.payoutCount > 0}
                    title={row.payoutCount > 0 ? `Referenced by ${row.payoutCount} payout statement(s)` : undefined}
                    onClick={() => void remove(row)}
                  >
                    <Trash2 />
                    Delete
                  </Button>
                </PermissionGate>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <BankAccountDialog
          sellerId={sellerId}
          account={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      ) : null}
      {revealed ? <RevealDialog key={revealed.id} revealed={revealed} onClose={() => setRevealed(null)} /> : null}
      {confirmDialog}
    </div>
  );
}

function BankAccountDialog({
  sellerId,
  account,
  onClose,
  onSaved,
}: {
  sellerId: string;
  account: SellerBankAccountRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { pending, run } = useActionToast();
  const [form, setForm] = React.useState({
    accountHolder: account?.accountHolder ?? "",
    bankName: account?.bankName ?? "",
    accountNumber: "",
    ifsc: account?.ifsc ?? "",
    upiId: account?.upiId ?? "",
    isPrimary: account?.isPrimary ?? false,
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    const result = account
      ? await run(() => updateBankAccountAction(sellerId, account.id, form), { onSuccess: onSaved })
      : await run(() => addBankAccountAction(sellerId, form), { onSuccess: onSaved });
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  const field = (key: keyof typeof form, label: string, props: Partial<React.ComponentProps<typeof Input>> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`bank-${key}`} className="text-xs">
        {label}
      </Label>
      <Input
        id={`bank-${key}`}
        value={form[key] as string}
        aria-invalid={Boolean(errors[key])}
        onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
        disabled={pending}
        {...props}
      />
      {errors[key] ? <p className="text-destructive text-xs">{errors[key]}</p> : null}
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{account ? "Edit bank account" : "Add bank account"}</DialogTitle>
            <DialogDescription>
              {account ? "Leave the account number blank to keep the stored one. Changing the number or IFSC un-verifies the account." : "The number is encrypted before it is stored."}
            </DialogDescription>
          </DialogHeader>
          {field("accountHolder", "Account holder", { maxLength: 120, autoFocus: true })}
          {field("bankName", "Bank name", { maxLength: 120 })}
          {field("accountNumber", account ? "New account number (optional)" : "Account number", { inputMode: "numeric", autoComplete: "off", className: "font-mono", placeholder: account ? `•••• ${account.accountNumberLast4}` : "" })}
          {field("ifsc", "IFSC", { maxLength: 11, className: "font-mono uppercase" })}
          {field("upiId", "UPI id (optional)", { placeholder: "name@bank", className: "font-mono" })}
          {!account ? (
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={form.isPrimary} onCheckedChange={(checked) => setForm((current) => ({ ...current, isPrimary: checked === true }))} />
              Make this the primary payout account
            </label>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {account ? "Save" : "Add account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const REVEAL_SECONDS = 30;

/** Remounted per reveal (keyed by account id) so the countdown starts fresh without setState in an effect. */
function RevealDialog({ revealed, onClose }: { revealed: RevealedBankAccount; onClose: () => void }) {
  const [left, setLeft] = React.useState(REVEAL_SECONDS);

  React.useEffect(() => {
    const timer = setInterval(() => setLeft((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  React.useEffect(() => {
    if (left === 0) onClose();
  }, [left, onClose]);

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{revealed.bankName}</DialogTitle>
          <DialogDescription>This reveal has been recorded in the audit log. Closes automatically in {left}s.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground text-xs">Holder</dt>
          <dd>{revealed.accountHolder}</dd>
          <dt className="text-muted-foreground text-xs">Account</dt>
          <dd className="flex items-center gap-1 font-mono">
            {revealed.accountNumber}
            <CopyButton value={revealed.accountNumber} label="Copy account number" />
          </dd>
          <dt className="text-muted-foreground text-xs">IFSC</dt>
          <dd className="flex items-center gap-1 font-mono">
            {revealed.ifsc}
            <CopyButton value={revealed.ifsc} label="Copy IFSC" />
          </dd>
          {revealed.upiId ? (
            <>
              <dt className="text-muted-foreground text-xs">UPI</dt>
              <dd className="font-mono">{revealed.upiId}</dd>
            </>
          ) : null}
        </dl>
        <DialogFooter>
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
