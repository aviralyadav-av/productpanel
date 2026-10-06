"use client";

import * as React from "react";

import { ErrorState } from "@/components/shared/error-state";

/** Keeps the shell when the FAQ board fails; the shared boundary above would blank it. */
export default function FaqsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error("FAQS ERROR", error);
  }, [error]);

  return (
    <div className="surface">
      <ErrorState
        title="The FAQs screen failed to load"
        description={error.digest ? `Reference ${error.digest}. The error has been logged.` : "The error has been logged to the server console."}
        retry={reset}
      />
    </div>
  );
}
