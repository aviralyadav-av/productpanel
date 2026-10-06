"use client";

import * as React from "react";

import { ErrorState } from "@/components/shared/error-state";

/**
 * Scoped to /admin/sellers so a failing seller query keeps the shell and the
 * sidebar; the operator can retry or move on without losing their place.
 */
export default function SellersError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error("SELLERS ERROR", error);
  }, [error]);

  return (
    <ErrorState
      title="The sellers screen failed to load"
      description={error.digest ? `The error has been logged (reference ${error.digest}).` : "The error has been logged to the server console."}
      retry={reset}
    />
  );
}
