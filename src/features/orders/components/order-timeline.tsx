"use client";

import * as React from "react";
import {
  Banknote,
  CircleDot,
  Info,
  LoaderCircle,
  Lock,
  MessageSquare,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill } from "@/components/shared/status-badge";
import { formatIstDateTime } from "@/lib/dates";
import { addOrderNote } from "@/features/orders/actions";
import type { OrderTimelineEvent } from "@/features/orders/queries";

/**
 * OrderEvent is append-only, so this feed is the order's real history - the
 * timestamp columns on Order are only a fast path for the ones that have a
 * column. Ascending order, because you read a history forwards.
 */
const EVENT_META: Record<
  string,
  { icon: LucideIcon; title: string; className: string }
> = {
  STATUS_CHANGE: {
    icon: CircleDot,
    title: "Status changed",
    className: "text-info",
  },
  PAYMENT: { icon: Banknote, title: "Payment", className: "text-success" },
  REFUND: { icon: Undo2, title: "Refund", className: "text-warning" },
  NOTE: { icon: MessageSquare, title: "Note", className: "text-brand" },
  SYSTEM: { icon: Info, title: "System", className: "text-muted-foreground" },
};

export function OrderTimeline({
  orderId,
  events,
}: {
  orderId: string;
  events: OrderTimelineEvent[];
}) {
  return (
    <div className="divide-y">
      {events.length === 0 ? (
        <EmptyState
          compact
          icon={Info}
          title="Nothing recorded yet"
          description="Status changes, payments, refunds and notes all land here as they happen."
        />
      ) : (
        <ol className="p-4">
          {events.map((event, index) => (
            <TimelineRow
              key={event.id}
              event={event}
              isLast={index === events.length - 1}
            />
          ))}
        </ol>
      )}

      <NoteComposer orderId={orderId} />
    </div>
  );
}

function TimelineRow({
  event,
  isLast,
}: {
  event: OrderTimelineEvent;
  isLast: boolean;
}) {
  const meta = EVENT_META[event.type] ?? EVENT_META.SYSTEM;
  const Icon = meta.icon;
  const isNote = event.type === "NOTE";

  return (
    <li className={cn("relative flex gap-3", isLast ? "pb-0" : "pb-4")}>
      {/* The connector, drawn behind the marker so it reads as one line. */}
      {isLast ? null : (
        <span
          aria-hidden
          className="bg-border absolute top-6 bottom-0 left-[11px] w-px"
        />
      )}

      <span
        className={cn(
          "bg-card z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border",
          meta.className,
        )}
      >
        <Icon className="size-3" />
      </span>

      <div className="min-w-0 flex-1 pb-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-xs font-medium">
            {isNote && event.isInternal ? "Internal note" : meta.title}
          </p>
          {event.isInternal ? (
            <StatusPill
              dot={false}
              tone="warning"
              label="Admin only"
              className="h-4 gap-1 px-1.5 text-[10px]"
            />
          ) : null}
          <span className="text-muted-foreground text-[11px]">
            {formatIstDateTime(event.createdAt)}
            {event.actorName ? ` · ${event.actorName}` : " · system"}
          </span>
        </div>

        <div
          className={cn(
            "mt-1 text-xs leading-relaxed whitespace-pre-wrap",
            // An internal note is visually a different kind of object from a
            // system event: it is someone's words, and it never leaves this
            // panel.
            event.isInternal &&
              "border-warning/30 bg-warning-muted/40 rounded-md border border-dashed px-2 py-1.5",
          )}
        >
          {event.message}
        </div>
      </div>
    </li>
  );
}

function NoteComposer({ orderId }: { orderId: string }) {
  const [pending, startTransition] = React.useTransition();
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await addOrderNote({ orderId, message });

      if (result.ok) {
        toast.success(result.message ?? "Note added.");
        setMessage("");
        return;
      }

      setError(result.fieldErrors?.message ?? result.error);
    });
  }

  return (
    <div className="bg-muted/30 space-y-2 p-4">
      <Textarea
        rows={2}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        aria-label="Internal note"
        aria-invalid={Boolean(error)}
        placeholder="Add an internal note — what the customer said on the phone, why this order is on hold…"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className={cn(
            "inline-flex items-center gap-1.5 text-[11px]",
            error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {error ? null : <Lock className="size-3" />}
          {error ??
            "Notes are internal. Nothing in this project shows them to a customer."}
        </p>

        <Button
          size="sm"
          disabled={pending || message.trim().length === 0}
          onClick={submit}
        >
          {pending ? <LoaderCircle className="animate-spin" /> : null}
          Add note
        </Button>
      </div>
    </div>
  );
}
