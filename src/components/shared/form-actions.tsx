"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";

/**
 * The sticky bar at the bottom of an edit form: status text on the left
 * ("Unsaved changes", "Saved 2 minutes ago"), Cancel and Save on the right.
 *
 * It sticks because the forms it sits under are long and the save button must
 * never be a scroll away. It is also the one place `dirty` is surfaced, so
 * an operator who has changed something and is about to navigate away has a
 * visible cue; the beforeunload prompt is opt-in via `warnOnLeave`.
 *
 * @example
 *   <FormActions dirty={isDirty} pending={pending} onCancel={() => router.back()} submitLabel="Save product" />
 *   (inside a <form>, the Save button submits it; pass onSubmit to use a click handler instead)
 */
export function FormActions({
  dirty = false,
  pending = false,
  submitLabel = "Save changes",
  cancelLabel = "Cancel",
  onCancel,
  onSubmit,
  status,
  warnOnLeave = true,
  disabled,
  secondary,
  className,
}: {
  dirty?: boolean;
  pending?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
  onCancel?: () => void;
  /** When omitted the button is type="submit" for the enclosing form. */
  onSubmit?: () => void;
  /** Overrides the automatic status text. */
  status?: React.ReactNode;
  warnOnLeave?: boolean;
  disabled?: boolean;
  /** Extra buttons placed before Cancel (e.g. "Save as draft"). */
  secondary?: React.ReactNode;
  className?: string;
}) {
  React.useEffect(() => {
    if (!dirty || !warnOnLeave) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, warnOnLeave]);

  const statusText =
    status ??
    (pending ? "Saving" : dirty ? "Unsaved changes" : null);

  return (
    <div
      className={cn(
        "bg-background/95 supports-backdrop-filter:bg-background/80 sticky bottom-0 z-20 -mx-4 flex items-center justify-between gap-3 border-t px-4 py-2.5 backdrop-blur sm:mx-0 sm:rounded-lg sm:border",
        className,
      )}
    >
      <p
        role="status"
        aria-live="polite"
        className={cn(
          "text-xs",
          dirty && !pending ? "text-warning font-medium" : "text-muted-foreground",
        )}
      >
        {statusText}
      </p>
      <div className="flex items-center gap-2">
        {secondary}
        {onCancel ? (
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onCancel}>
            {cancelLabel}
          </Button>
        ) : null}
        <Button
          type={onSubmit ? "button" : "submit"}
          size="sm"
          disabled={disabled || pending}
          onClick={onSubmit}
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
