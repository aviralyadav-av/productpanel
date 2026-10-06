"use client";

import * as React from "react";

import { ErrorState } from "@/components/shared/error-state";

/** Scoped to /admin/reviews so a failing query keeps the shell and sidebar. */
export default function ReviewsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error("REVIEWS ERROR", error);
  }, [error]);

  return (
    <ErrorState
      title="The reviews screen failed to load"
      description={error.digest ? `The error has been logged (reference ${error.digest}).` : "The error has been logged to the server console."}
      retry={reset}
    />
  );
}
