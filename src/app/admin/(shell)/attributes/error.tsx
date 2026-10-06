"use client";

import * as React from "react";

import { ErrorState } from "@/components/shared/error-state";

/** Keeps the shell when an attributes screen fails. */
export default function AttributesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error("ATTRIBUTES ERROR", error);
  }, [error]);

  return (
    <div className="surface">
      <ErrorState
        title="The attributes screen failed to load"
        description={error.digest ? `Reference ${error.digest}. The error has been logged.` : "The error has been logged to the server console."}
        retry={reset}
      />
    </div>
  );
}
