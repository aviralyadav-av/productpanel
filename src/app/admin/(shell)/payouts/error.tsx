"use client";

import * as React from "react";

import { ErrorState } from "@/components/shared/error-state";

/**
 * Scoped to /admin/payouts. Money screens fail loudly rather than rendering a
 * partial number: an empty balance column would read as "nothing is owed".
 */
export default function PayoutsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("PAYOUTS ERROR", error);
  }, [error]);

  return (
    <ErrorState
      title="Payouts could not be loaded"
      description="Balances, statements or the ledger failed to load. No figure on this screen should be trusted until it renders in full."
      retry={reset}
    />
  );
}
