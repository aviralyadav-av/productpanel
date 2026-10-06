"use client";

import * as React from "react";

import { ErrorState } from "@/components/shared/error-state";

/**
 * Scoped to the inventory segment so a failing stock query keeps the shell
 * and the operator's place; the segment above would blank the sidebar too.
 */
export default function InventoryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("INVENTORY ERROR", error);
  }, [error]);

  return (
    <ErrorState
      title="Inventory failed to load"
      description={
        error.digest ? (
          <>
            The error has been logged. Reference <code className="font-mono">{error.digest}</code>.
          </>
        ) : (
          "The error has been logged to the server console."
        )
      }
      retry={reset}
    />
  );
}
