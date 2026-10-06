"use client";

import * as React from "react";

import { ErrorState } from "@/components/shared/error-state";

/** Keeps the shell (sidebar, topbar) when a customer screen fails; the (shell) boundary is the fallback for everything else. */
export default function CustomersError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error("CUSTOMERS ERROR", error);
  }, [error]);

  return (
    <div className="surface">
      <ErrorState
        title="The customers screen failed to load"
        description={error.digest ? `The error has been logged (${error.digest}).` : "The error has been logged to the server console."}
        retry={reset}
      />
    </div>
  );
}
