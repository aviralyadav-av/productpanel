"use client";

import * as React from "react";

import { ErrorState } from "@/components/shared/error-state";

/** Scoped to /admin/newsletter so a failing query keeps the shell and sidebar. */
export default function NewsletterError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error("NEWSLETTER ERROR", error);
  }, [error]);

  return (
    <ErrorState
      title="The newsletter screen failed to load"
      description={error.digest ? `The error has been logged (reference ${error.digest}).` : "The error has been logged to the server console."}
      retry={reset}
    />
  );
}
