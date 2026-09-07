"use client";

import * as React from "react";
import { OctagonAlert, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Scoped to the dashboard segment so a failing page keeps the sidebar, the
 * topbar and the operator's place in the app. A root-level boundary would
 * blank the whole shell for one broken query.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("DASHBOARD ERROR", error);
  }, [error]);

  const isDatabase =
    error.message.includes("DATABASE_URL") ||
    error.message.includes("ECONNREFUSED") ||
    error.message.toLowerCase().includes("password authentication");

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="bg-destructive/10 text-destructive mb-4 flex size-10 items-center justify-center rounded-full">
        <OctagonAlert className="size-5" />
      </div>

      <h1 className="text-base font-semibold tracking-tight">
        {isDatabase ? "Cannot reach the database" : "This page failed to load"}
      </h1>

      <p className="text-muted-foreground mt-2 max-w-md text-xs leading-relaxed">
        {isDatabase ? (
          <>
            Check that <code className="font-mono">DATABASE_URL</code> in{" "}
            <code className="font-mono">.env</code> points at a running
            PostgreSQL instance, then run{" "}
            <code className="font-mono">npm run db:migrate</code>.
          </>
        ) : (
          "The error has been logged to the server console."
        )}
      </p>

      {error.digest ? (
        <p className="text-muted-foreground/70 mt-2 font-mono text-[11px]">
          {error.digest}
        </p>
      ) : null}

      <Button onClick={reset} variant="outline" size="sm" className="mt-5">
        <RotateCw className="size-3.5" />
        Try again
      </Button>
    </div>
  );
}
