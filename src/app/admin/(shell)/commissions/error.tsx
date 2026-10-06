"use client";

import * as React from "react";

import { ErrorState } from "@/components/shared/error-state";

/**
 * Scoped to /admin/commissions so a failing aggregate (the range summary reads
 * every order line in the window) does not take the shell down with it.
 */
export default function CommissionsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("COMMISSIONS ERROR", error);
  }, [error]);

  return (
    <ErrorState
      title="Commissions could not be loaded"
      description="The rules, the charge settings or the range summary failed to load. The error is in the server console."
      retry={reset}
    />
  );
}
