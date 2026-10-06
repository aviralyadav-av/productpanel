"use client";

import * as React from "react";

import { ErrorState } from "@/components/shared/error-state";

/** Keeps the shell when the homepage board or a section preview fails. */
export default function HomepageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error("HOMEPAGE ERROR", error);
  }, [error]);

  return (
    <div className="surface">
      <ErrorState
        title="The homepage screen failed to load"
        description={error.digest ? `The error has been logged (${error.digest}).` : "The error has been logged to the server console."}
        retry={reset}
      />
    </div>
  );
}
