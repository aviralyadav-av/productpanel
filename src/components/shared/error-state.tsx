"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";

/**
 * The failure counterpart to EmptyState, with the same geometry so a panel
 * that flips from loading to error does not change size. Says what failed in
 * operator terms and offers one action: retry. Used by error.tsx boundaries
 * (pass `reset`) and by client widgets whose fetch failed.
 */
export function ErrorState({
  title = "Something went wrong",
  description,
  retry,
  retryLabel = "Try again",
  className,
  compact = false,
}: {
  title?: string;
  description?: React.ReactNode;
  retry?: () => void;
  retryLabel?: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-1.5 px-4 py-8" : "gap-2 px-6 py-14",
        className,
      )}
    >
      <div className="bg-destructive/10 text-destructive mb-1 flex size-9 items-center justify-center rounded-full">
        <AlertTriangle className="size-4" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="text-muted-foreground max-w-sm text-xs leading-relaxed">{description}</p>
      ) : null}
      {retry ? (
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={retry}>
          <RotateCcw />
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
