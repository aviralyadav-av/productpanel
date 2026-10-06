"use client";

import * as React from "react";

import { ErrorState } from "@/components/shared/error-state";

/** Keeps the shell when a category screen fails; the shared boundary above would blank it. */
export default function CategoriesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error("CATEGORIES ERROR", error);
  }, [error]);

  return (
    <div className="surface">
      <ErrorState
        title="The categories screen failed to load"
        description={error.digest ? `Reference ${error.digest}. The error has been logged.` : "The error has been logged to the server console."}
        retry={reset}
      />
    </div>
  );
}
