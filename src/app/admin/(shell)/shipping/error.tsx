"use client";

import * as React from "react";

import { ErrorState } from "@/components/shared/error-state";

/** Keeps the shell (sidebar, topbar) when the shipping page throws; the segment-level boundary is enough. */
export default function ShippingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error("SHIPPING PAGE ERROR", error);
  }, [error]);

  return (
    <div className="surface">
      <ErrorState
        title="Shipping could not be loaded"
        description={error.digest ? `The error has been logged (${error.digest}).` : "The error has been logged to the server console."}
        retry={reset}
      />
    </div>
  );
}
