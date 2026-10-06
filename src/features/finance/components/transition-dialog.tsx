"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { type PayoutMethod, type PayoutStatus } from "@/lib/enums";
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
import { FormRow } from "@/components/shared/form-layout";
import { useActionToast } from "@/components/shared/use-action-toast";

import { transitionPayoutAction } from "../actions";
import type { BankAccountOption } from "../payout-queries";

/**
 * Moving a statement along the B5 flow (blueprint §14.B5, D14).
 *
 * Each target status asks for exactly what it needs and says what it will do
 * to the ledger before the operator commits: PROCESSING snapshots an account,
 * PAID demands a bank reference (money that left without one cannot be
 * reconciled), FAILED demands a reason and hands the entries back.
 *
 * The form is mounted only while open and keyed by the target status, so it
 * starts clean without an effect that would show the previous attempt's values.
 */


// ---------------------------------------------------------------------------
// Statement transitions
// ---------------------------------------------------------------------------

export type TransitionTarget = Extract<
  PayoutStatus,
  "APPROVED" | "PROCESSING" | "PAID" | "FAILED" | "CANCELLED"
>;

const TRANSITION_COPY: Record<
  TransitionTarget,
  { title: string; description: string; confirmLabel: string; destructive?: boolean }
> = {
  APPROVED: {
    title: "Approve statement",
    description: "Approving confirms the totals. The entries stay scheduled until the transfer is made.",
    confirmLabel: "Approve",
  },
  PROCESSING: {
    title: "Mark processing",
    description:
      "Choose the account the money is going to. A masked copy is snapshotted onto the statement, so it records where the money went even if the seller changes accounts later.",
    confirmLabel: "Mark processing",
  },
  PAID: {
    title: "Mark paid",
    description:
      "The scheduled entries become paid and one PAYOUT entry is appended for the net. This cannot be undone.",
    confirmLabel: "Mark paid",
  },
  FAILED: {
    title: "Mark failed",
    description: "The entries return to available and will be picked up by the next statement.",
    confirmLabel: "Mark failed",
    destructive: true,
  },
  CANCELLED: {
    title: "Cancel statement",
    description: "The entries return to available and will be picked up by the next statement.",
    confirmLabel: "Cancel statement",
    destructive: true,
  },
};

export function TransitionPayoutDialog({
  open,
  onOpenChange,
  payoutId,
  payoutNumber,
  netPaise,
  toStatus,
  bankAccounts,
  currentBankAccountId,
  method,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payoutId: string;
  payoutNumber: string;
  netPaise: number;
  toStatus: TransitionTarget | null;
  bankAccounts: BankAccountOption[];
  currentBankAccountId: string | null;
  method: PayoutMethod;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && toStatus ? (
        <TransitionForm
          key={toStatus}
          payoutId={payoutId}
          payoutNumber={payoutNumber}
          netPaise={netPaise}
          toStatus={toStatus}
          bankAccounts={bankAccounts}
          currentBankAccountId={currentBankAccountId}
          method={method}
          onOpenChange={onOpenChange}
        />
      ) : null}
    </Dialog>
  );
}

function TransitionForm({
  payoutId,
  payoutNumber,
  netPaise,
  toStatus,
  bankAccounts,
  currentBankAccountId,
  method,
  onOpenChange,
}: {
  payoutId: string;
  payoutNumber: string;
  netPaise: number;
  toStatus: TransitionTarget;
  bankAccounts: BankAccountOption[];
  currentBankAccountId: string | null;
  method: PayoutMethod;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [referenceNumber, setReferenceNumber] = React.useState("");
  const [failureReason, setFailureReason] = React.useState("");
  const [bankAccountId, setBankAccountId] = React.useState(
    () =>
      currentBankAccountId ?? bankAccounts.find((account) => account.isPrimary)?.id ?? bankAccounts[0]?.id ?? "",
  );
  const [notes, setNotes] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const copy = TRANSITION_COPY[toStatus];

  async function submit() {
    const result = await run(
      () =>
        transitionPayoutAction(payoutId, {
          toStatus,
          referenceNumber: referenceNumber.trim() || null,
          failureReason: failureReason.trim() || null,
          bankAccountId: toStatus === "PROCESSING" ? bankAccountId || null : null,
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
        <DialogTitle>
          {copy.title} · {payoutNumber}
        </DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="bg-muted/40 flex items-center justify-between rounded-md p-3 text-xs">
          <span className="text-muted-foreground">Net payable</span>
          <span className="font-semibold tabular-nums">{formatPaise(netPaise)}</span>
        </div>

        {toStatus === "PROCESSING" ? (
          <FormRow
            label="Bank account"
            htmlFor="tr-account"
            error={errors.bankAccountId}
            required={method !== "MANUAL"}
            hint={
              bankAccounts.length === 0
                ? "No account on file. Add one on the seller's profile, or use the manual method."
                : "Only the last four digits are ever stored on the statement."
            }
          >
            <Select
              value={bankAccountId || "none"}
              onValueChange={(value) => setBankAccountId(value === "none" ? "" : value)}
            >
              <SelectTrigger id="tr-account" aria-invalid={Boolean(errors.bankAccountId)}>
                <SelectValue placeholder="Choose an account" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No account (manual)</SelectItem>
                {bankAccounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.label}
                    {account.isVerified ? "" : " (unverified)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
        ) : null}

        {toStatus === "PAID" ? (
          <FormRow
            label="Bank reference"
            htmlFor="tr-reference"
            error={errors.referenceNumber}
            required
            hint="The UTR or transaction id. Without it the payment cannot be reconciled."
          >
            <Input
              id="tr-reference"
              value={referenceNumber}
              maxLength={120}
              onChange={(event) => setReferenceNumber(event.target.value)}
              placeholder="UTR / transaction id"
              aria-invalid={Boolean(errors.referenceNumber)}
            />
          </FormRow>
        ) : null}

        {toStatus === "FAILED" ? (
          <FormRow label="Reason" htmlFor="tr-reason" error={errors.failureReason} required>
            <Textarea
              id="tr-reason"
              rows={2}
              maxLength={500}
              value={failureReason}
              onChange={(event) => setFailureReason(event.target.value)}
              placeholder="Bank rejected the IFSC"
              aria-invalid={Boolean(errors.failureReason)}
            />
          </FormRow>
        ) : null}

        {toStatus === "CANCELLED" ? (
          <FormRow label="Reason" htmlFor="tr-cancel-reason" error={errors.failureReason}>
            <Textarea
              id="tr-cancel-reason"
              rows={2}
              maxLength={500}
              value={failureReason}
              onChange={(event) => setFailureReason(event.target.value)}
              placeholder="Superseded by a corrected run"
            />
          </FormRow>
        ) : null}

        <FormRow label="Notes" htmlFor="tr-notes" error={errors.notes}>
          <Textarea
            id="tr-notes"
            rows={2}
            maxLength={1000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </FormRow>
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
          Back
        </Button>
        <Button
          size="sm"
          variant={copy.destructive ? "destructive" : "default"}
          onClick={submit}
          disabled={pending}
        >
          {copy.confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
