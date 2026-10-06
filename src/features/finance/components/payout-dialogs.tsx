"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { PAYOUT_METHODS, PAYOUT_METHOD_META, type PayoutMethod } from "@/lib/enums";
import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EntityPicker, type EntityRef } from "@/components/shared/entity-picker";
import { FormRow } from "@/components/shared/form-layout";
import { MoneyInput } from "@/components/shared/money-input";
import { useActionToast } from "@/components/shared/use-action-toast";

import { generatePayoutAction, loadBankAccountsAction, recordAdjustmentAction } from "../actions";
import type { BankAccountOption } from "../payout-queries";

/**
 * Generating a statement and recording a manual adjustment - the two dialogs
 * that create ledger movement on /admin/payouts (blueprint §14.B5, D14).
 * Moving an existing statement lives in `transition-dialog.tsx`.
 *
 * They share one rule: the operator must see, before confirming, exactly what
 * will happen to the ledger - how much is available, whether it is below the
 * minimum, and which sign an adjustment carries.
 *
 * Each dialog mounts its form ONLY while open, keyed by the record it edits.
 * Remounting is how the form gets clean state; an effect that reset the fields
 * would render the previous record's values once first.
 */

/** `Date` → the value an `<input type="date">` wants, in the browser's zone. */
function toDateInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Generate a statement
// ---------------------------------------------------------------------------

export function GenerateStatementDialog({
  open,
  onOpenChange,
  seller,
  availablePaise,
  minPayoutPaise,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seller: { id: string; name: string } | null;
  availablePaise: number;
  minPayoutPaise: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && seller ? (
        <GenerateStatementForm
          key={seller.id}
          seller={seller}
          availablePaise={availablePaise}
          minPayoutPaise={minPayoutPaise}
          onOpenChange={onOpenChange}
        />
      ) : null}
    </Dialog>
  );
}

function GenerateStatementForm({
  seller,
  availablePaise,
  minPayoutPaise,
  onOpenChange,
}: {
  seller: { id: string; name: string };
  availablePaise: number;
  minPayoutPaise: number;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [periodTo, setPeriodTo] = React.useState(() => toDateInput(new Date()));
  const [method, setMethod] = React.useState<PayoutMethod>("BANK_TRANSFER");
  const [bankAccountId, setBankAccountId] = React.useState<string>("");
  const [notes, setNotes] = React.useState("");
  const [accounts, setAccounts] = React.useState<BankAccountOption[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // A genuine external read: the accounts are not in the table's props, and
  // loading every seller's accounts up front would be far more expensive.
  const sellerId = seller.id;
  React.useEffect(() => {
    let cancelled = false;
    void loadBankAccountsAction(sellerId).then((result) => {
      if (cancelled || !result.ok) return;
      setAccounts(result.data);
      setBankAccountId(result.data.find((account) => account.isPrimary)?.id ?? result.data[0]?.id ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [sellerId]);

  const willHold = availablePaise <= minPayoutPaise;

  async function submit() {
    const result = await run(
      () =>
        generatePayoutAction({
          sellerId: seller.id,
          // End of the chosen day, so "today" includes everything released today.
          periodTo: periodTo ? `${periodTo}T23:59:59` : null,
          method,
          bankAccountId: bankAccountId || null,
          notes: notes.trim() || null,
        }),
      {
        onSuccess: () => {
          onOpenChange(false);
          router.refresh();
        },
      },
    );
    if (!result.ok) setErrors(result.fieldErrors ?? {});
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Generate statement</DialogTitle>
        <DialogDescription>
          Everything available on or before this date moves onto one statement for {seller.name}.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="bg-muted/40 rounded-md p-3 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Available now</span>
            <span className="font-medium tabular-nums">{formatPaise(availablePaise)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Minimum payout</span>
            <span className="tabular-nums">{formatPaise(minPayoutPaise)}</span>
          </div>
          {willHold ? (
            <p className="text-warning mt-2">
              This is at or below the minimum, so no statement will be created. The earnings stay available
              and carry forward to the next run.
            </p>
          ) : null}
        </div>

        <FormRow label="Period to" htmlFor="gen-period" error={errors.periodTo} hint="Inclusive of that day.">
          <Input
            id="gen-period"
            type="date"
            value={periodTo}
            onChange={(event) => setPeriodTo(event.target.value)}
          />
        </FormRow>

        <FormRow label="Method" htmlFor="gen-method" error={errors.method}>
          <Select value={method} onValueChange={(value) => setMethod(value as PayoutMethod)}>
            <SelectTrigger id="gen-method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYOUT_METHODS.map((option) => (
                <SelectItem key={option} value={option}>
                  {PAYOUT_METHOD_META[option].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormRow>

        <FormRow
          label="Bank account"
          htmlFor="gen-account"
          error={errors.bankAccountId}
          hint={
            accounts.length === 0
              ? "This seller has no bank account on file. Add one before marking the statement processing."
              : "Snapshotted onto the statement when it moves to processing."
          }
        >
          <Select
            value={bankAccountId || "none"}
            onValueChange={(value) => setBankAccountId(value === "none" ? "" : value)}
            disabled={accounts.length === 0}
          >
            <SelectTrigger id="gen-account">
              <SelectValue placeholder="No account" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Decide later</SelectItem>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.label}
                  {account.isVerified ? "" : " (unverified)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormRow>

        <FormRow label="Notes" htmlFor="gen-notes" error={errors.notes}>
          <Textarea
            id="gen-notes"
            rows={2}
            maxLength={1000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Anything the finance team should know about this run."
          />
        </FormRow>
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={pending}>
          Generate
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ---------------------------------------------------------------------------
// Manual adjustment (payouts.adjust)
// ---------------------------------------------------------------------------

export function AdjustmentDialog({
  open,
  onOpenChange,
  initialSeller,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSeller?: EntityRef | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <AdjustmentForm initialSeller={initialSeller} onOpenChange={onOpenChange} /> : null}
    </Dialog>
  );
}

function AdjustmentForm({
  initialSeller,
  onOpenChange,
}: {
  initialSeller?: EntityRef | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [seller, setSeller] = React.useState<EntityRef | null>(initialSeller ?? null);
  const [direction, setDirection] = React.useState<"credit" | "debit">("credit");
  const [amountPaise, setAmountPaise] = React.useState<number | null>(null);
  const [description, setDescription] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  async function submit() {
    const magnitude = amountPaise ?? 0;
    const result = await run(
      () =>
        recordAdjustmentAction({
          sellerId: seller?.id ?? "",
          // The form asks for a direction and a positive amount; the ledger
          // stores one signed number, and the sign is the whole meaning.
          amountPaise: direction === "debit" ? -magnitude : magnitude,
          description: description.trim(),
        }),
      {
        onSuccess: () => {
          onOpenChange(false);
          router.refresh();
        },
      },
    );
    if (!result.ok) setErrors(result.fieldErrors ?? {});
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Manual ledger adjustment</DialogTitle>
        <DialogDescription>
          Appends a signed ADJUSTMENT entry as available immediately, so it lands on the seller&apos;s next
          statement. The ledger is append-only - this never edits a past sale.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <FormRow label="Seller" htmlFor="adj-seller" error={errors.sellerId} required>
          <EntityPicker
            id="adj-seller"
            kind="seller"
            value={seller}
            onChange={setSeller}
            invalid={Boolean(errors.sellerId)}
            placeholder="Search a seller…"
          />
        </FormRow>

        <FormRow label="Direction" htmlFor="adj-direction">
          <div className="flex gap-1.5" id="adj-direction">
            <Button
              type="button"
              size="sm"
              variant={direction === "credit" ? "default" : "outline"}
              onClick={() => setDirection("credit")}
            >
              Credit the seller
            </Button>
            <Button
              type="button"
              size="sm"
              variant={direction === "debit" ? "default" : "outline"}
              onClick={() => setDirection("debit")}
            >
              Debit the seller
            </Button>
          </div>
        </FormRow>

        <FormRow
          label="Amount"
          htmlFor="adj-amount"
          error={errors.amountPaise}
          required
          hint={direction === "debit" ? "Recorded as a negative entry." : "Recorded as a positive entry."}
        >
          <MoneyInput
            id="adj-amount"
            valuePaise={amountPaise}
            onChangePaise={setAmountPaise}
            invalid={Boolean(errors.amountPaise)}
            allowEmpty
          />
        </FormRow>

        <FormRow
          label="Reason"
          htmlFor="adj-description"
          error={errors.description}
          required
          hint="Shown on the statement and kept in the audit trail."
        >
          <Textarea
            id="adj-description"
            rows={2}
            maxLength={300}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Goodwill credit for the delayed October payout"
          />
        </FormRow>
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={pending}>
          Record adjustment
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
