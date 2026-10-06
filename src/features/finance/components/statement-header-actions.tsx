"use client";

import * as React from "react";

import { PAYOUT_STATUS_META, PAYOUT_TRANSITIONS, type PayoutMethod, type PayoutStatus } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { usePermission } from "@/components/shared/permission-gate";

import type { BankAccountOption } from "../payout-queries";
import { TransitionPayoutDialog, type TransitionTarget } from "./transition-dialog";

/**
 * The action buttons on a statement (blueprint §14.B5, D14).
 *
 * The available moves come from `PAYOUT_TRANSITIONS`, so the UI can never
 * offer a transition the service would refuse. Approve and cancel need
 * `payouts.approve`; process, paid and fail need `payouts.process` - the
 * separation of duties D14 asks for, enforced again on the server.
 */

const PERMISSION: Record<TransitionTarget, string> = {
  APPROVED: "payouts.approve",
  CANCELLED: "payouts.approve",
  PROCESSING: "payouts.process",
  PAID: "payouts.process",
  FAILED: "payouts.process",
};

const LABEL: Record<TransitionTarget, string> = {
  APPROVED: "Approve",
  PROCESSING: "Mark processing",
  PAID: "Mark paid",
  FAILED: "Mark failed",
  CANCELLED: "Cancel",
};

export function StatementHeaderActions({
  payoutId,
  payoutNumber,
  status,
  netPaise,
  method,
  bankAccounts,
  currentBankAccountId,
}: {
  payoutId: string;
  payoutNumber: string;
  status: PayoutStatus;
  netPaise: number;
  method: PayoutMethod;
  bankAccounts: BankAccountOption[];
  currentBankAccountId: string | null;
}) {
  const [target, setTarget] = React.useState<TransitionTarget | null>(null);
  const canApprove = usePermission("payouts.approve");
  const canProcess = usePermission("payouts.process");

  const granted = (permission: string) =>
    permission === "payouts.approve" ? canApprove : canProcess;

  const targets = (PAYOUT_TRANSITIONS[status] as readonly PayoutStatus[])
    .filter((next): next is TransitionTarget => next in PERMISSION)
    .filter((next) => granted(PERMISSION[next]));

  if (targets.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        {PAYOUT_TRANSITIONS[status].length === 0
          ? `${PAYOUT_STATUS_META[status].label} is final.`
          : "You do not have permission to move this statement."}
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {targets.map((next) => (
          <Button
            key={next}
            size="sm"
            variant={next === "FAILED" || next === "CANCELLED" ? "outline" : "default"}
            onClick={() => setTarget(next)}
          >
            {LABEL[next]}
          </Button>
        ))}
      </div>

      <TransitionPayoutDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        payoutId={payoutId}
        payoutNumber={payoutNumber}
        netPaise={netPaise}
        toStatus={target}
        bankAccounts={bankAccounts}
        currentBankAccountId={currentBankAccountId}
        method={method}
      />
    </>
  );
}
