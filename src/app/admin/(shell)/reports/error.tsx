"use client";

import * as React from "react";

import { ErrorState } from "@/components/shared/error-state";

/**
 * Scoped to /admin/reports so one failing aggregate does not blank the shell.
 *
 * Reports run raw aggregate SQL over the whole order history; the realistic
 * failures are a range so wide the query times out, or a filter combination
 * that produces no valid grouping. Both are recoverable by narrowing the
 * range, so the message says that rather than "an error occurred".
 */
export default function ReportsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("REPORTS ERROR", error);
  }, [error]);

  return (
    <div className="surface">
      <ErrorState
        title="This report failed to run"
        description={
          <>
            The query did not complete. Try a narrower date range or fewer filters; if it keeps failing, the
            server console has the details.
            {error.digest ? <span className="mt-1 block font-mono text-[11px]">{error.digest}</span> : null}
          </>
        }
        retry={reset}
      />
    </div>
  );
}
