"use client";

import * as React from "react";

import { ErrorState } from "@/components/shared/error-state";

/** Scoped to /admin/inquiries so a failing query keeps the shell and sidebar. */
export default function InquiriesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error("INQUIRIES ERROR", error);
  }, [error]);

  return (
    <ErrorState
      title="The inquiries screen failed to load"
      description={error.digest ? `The error has been logged (reference ${error.digest}).` : "The error has been logged to the server console."}
      retry={reset}
    />
  );
}
