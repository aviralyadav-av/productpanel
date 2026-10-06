"use client";

import * as React from "react";

import { ErrorState } from "@/components/shared/error-state";

/** Keeps the shell when a menu fails to load; the (shell) boundary catches everything else. */
export default function NavigationError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error("NAVIGATION ERROR", error);
  }, [error]);

  return (
    <div className="surface">
      <ErrorState
        title="The navigation screen failed to load"
        description={error.digest ? `The error has been logged (${error.digest}).` : "The error has been logged to the server console."}
        retry={reset}
      />
    </div>
  );
}
