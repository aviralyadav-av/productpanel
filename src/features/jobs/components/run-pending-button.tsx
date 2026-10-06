"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useActionToast } from "@/components/shared/use-action-toast";

import { runPendingJobsAction, type RunPendingResult } from "@/features/jobs/actions";
import { RUN_PENDING_LIMIT } from "@/features/jobs/schemas";

/**
 * Drains the queue from the browser and then SHOWS WHAT HAPPENED.
 *
 * A toast alone would be the wrong shape here: an operator presses this
 * precisely when something is stuck, and the useful answer is per-job
 * ("payout.generate failed: seller has no bank account"), not a count. So the
 * summary opens in a dialog and stays until dismissed.
 */
export function RunPendingButton() {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [summary, setSummary] = React.useState<RunPendingResult | null>(null);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          void run(() => runPendingJobsAction(), {
            onSuccess: (data) => {
              setSummary(data);
              router.refresh();
            },
          })
        }
      >
        <Play /> Run pending now
      </Button>

      <Dialog open={summary !== null} onOpenChange={(open) => (!open ? setSummary(null) : undefined)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Queue run</DialogTitle>
            <DialogDescription>
              Up to {RUN_PENDING_LIMIT} due jobs, executed inside this request as worker “admin-ui”.
            </DialogDescription>
          </DialogHeader>

          {summary ? (
            <div className="space-y-3 text-xs">
              <dl className="grid grid-cols-2 gap-y-1.5">
                <dt className="text-muted-foreground">Claimed</dt>
                <dd data-numeric className="text-right">{summary.summary.claimed}</dd>
                <dt className="text-muted-foreground">Completed</dt>
                <dd data-numeric className="text-right">{summary.summary.completed}</dd>
                <dt className="text-muted-foreground">Will retry</dt>
                <dd data-numeric className="text-right">{summary.summary.retried}</dd>
                <dt className="text-muted-foreground">Failed for good</dt>
                <dd data-numeric className="text-right">{summary.summary.failed}</dd>
                <dt className="text-muted-foreground">Stale locks released</dt>
                <dd data-numeric className="text-right">{summary.summary.releasedStale}</dd>
              </dl>

              {summary.scheduled.enqueued.length > 0 ? (
                <p className="text-muted-foreground">
                  Recurring jobs enqueued: {summary.scheduled.enqueued.join(", ")}.
                </p>
              ) : null}

              {summary.summary.outcomes.length > 0 ? (
                <ul className="max-h-56 space-y-1 overflow-auto border-t pt-2">
                  {summary.summary.outcomes.map((outcome) => (
                    <li key={outcome.id} className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium">{outcome.type}</span>
                      <span className="text-muted-foreground">{outcome.status}</span>
                      <span data-numeric className="text-muted-foreground/80">
                        {outcome.durationMs} ms
                      </span>
                      {outcome.error ? (
                        <span className="text-destructive w-full break-words">{outcome.error}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground border-t pt-2">
                  Nothing was due. Recurring work is scheduled in buckets, so an empty run usually means the last one
                  already covered this period.
                </p>
              )}

              {summary.scheduled.skipped.length > 0 ? (
                <div className="border-t pt-2">
                  <p className="text-muted-foreground">Cadences skipped (no handler registered):</p>
                  <ul className="text-muted-foreground/80 mt-1 space-y-0.5">
                    {summary.scheduled.skipped.map((entry) => (
                      <li key={entry.type}>
                        {entry.type} — {entry.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSummary(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
