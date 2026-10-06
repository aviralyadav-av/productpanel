import { Check } from "lucide-react";
import { cn } from "cn";

export type StepperStep = {
  id: string;
  label: string;
  description?: string;
  /** Overrides the position-derived state, e.g. a failed step. */
  status?: "complete" | "current" | "upcoming" | "error";
};

/**
 * Progress through a fixed sequence: order fulfilment (placed, confirmed,
 * packed, shipped, delivered), seller onboarding, a multi-page import wizard.
 * Steps before `currentIndex` are complete, the one at it is current, the rest
 * upcoming, unless a step overrides its own status.
 *
 * Server-compatible; interactive steppers wrap it and pass `onStepClick`.
 */
export function Stepper({
  steps,
  currentIndex,
  orientation = "horizontal",
  onStepClick,
  className,
}: {
  steps: StepperStep[];
  currentIndex: number;
  orientation?: "horizontal" | "vertical";
  /** Only steps already completed are clickable. */
  onStepClick?: (index: number) => void;
  className?: string;
}) {
  return (
    <ol
      className={cn(
        "flex",
        orientation === "horizontal" ? "items-start gap-2" : "flex-col gap-3",
        className,
      )}
      aria-label="Progress"
    >
      {steps.map((step, index) => {
        const status =
          step.status ??
          (index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming");
        const clickable = Boolean(onStepClick) && status === "complete";
        const isLast = index === steps.length - 1;

        const marker = (
          <span
            aria-hidden
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
              status === "complete" && "bg-primary text-primary-foreground border-primary",
              status === "current" && "border-brand text-brand ring-brand/20 ring-3",
              status === "upcoming" && "text-muted-foreground",
              status === "error" && "bg-destructive text-destructive-foreground border-destructive",
            )}
            data-numeric
          >
            {status === "complete" ? <Check className="size-3" /> : index + 1}
          </span>
        );

        const text = (
          <span className="min-w-0">
            <span
              className={cn(
                "block text-xs font-medium",
                status === "upcoming" && "text-muted-foreground",
                status === "error" && "text-destructive",
              )}
            >
              {step.label}
            </span>
            {step.description ? (
              <span className="text-muted-foreground block text-[11px] leading-snug">
                {step.description}
              </span>
            ) : null}
          </span>
        );

        return (
          <li
            key={step.id}
            aria-current={status === "current" ? "step" : undefined}
            className={cn(
              "flex min-w-0",
              orientation === "horizontal" ? "flex-1 flex-col gap-1.5" : "gap-3",
            )}
          >
            {orientation === "horizontal" ? (
              <>
                <div className="flex items-center gap-2">
                  {marker}
                  {!isLast ? (
                    <span
                      aria-hidden
                      className={cn(
                        "h-px flex-1",
                        status === "complete" ? "bg-primary" : "bg-border",
                      )}
                    />
                  ) : null}
                </div>
                {clickable ? (
                  <button type="button" className="text-left hover:underline" onClick={() => onStepClick?.(index)}>
                    {text}
                  </button>
                ) : (
                  text
                )}
              </>
            ) : (
              <>
                <div className="flex flex-col items-center">
                  {marker}
                  {!isLast ? (
                    <span
                      aria-hidden
                      className={cn("mt-1 w-px flex-1", status === "complete" ? "bg-primary" : "bg-border")}
                    />
                  ) : null}
                </div>
                {clickable ? (
                  <button type="button" className="pb-2 text-left hover:underline" onClick={() => onStepClick?.(index)}>
                    {text}
                  </button>
                ) : (
                  <div className="pb-2">{text}</div>
                )}
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}
