"use client";

import * as React from "react";
import { CreditCard, FileText, MessageSquare, Package, RotateCcw, Settings, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { BadgeTone } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { StatusTimeline, type TimelineEvent } from "@/components/shared/status-timeline";
import { useActionToast } from "@/components/shared/use-action-toast";

import { addOrderNoteAction } from "../actions";
import type { OrderDetailEvent } from "../detail-types";

/**
 * The order's history plus the note box.
 *
 * The internal switch defaults to ON: most notes an operator writes are for
 * the next colleague, and a note accidentally marked customer-visible is a
 * mistake that cannot be taken back once it reaches the tracking page.
 */

const EVENT_ICON: Record<string, LucideIcon> = {
  STATUS_CHANGE: Package,
  PAYMENT: CreditCard,
  SHIPMENT: Truck,
  NOTE: MessageSquare,
  SYSTEM: Settings,
  REFUND: RotateCcw,
  RETURN: RotateCcw,
};

const EVENT_TONE: Record<string, BadgeTone> = {
  STATUS_CHANGE: "brand",
  PAYMENT: "success",
  SHIPMENT: "info",
  NOTE: "neutral",
  SYSTEM: "neutral",
  REFUND: "warning",
  RETURN: "warning",
};

export function OrderTimelineCard({
  orderId,
  events,
  canAddNotes,
}: {
  orderId: string;
  events: OrderDetailEvent[];
  canAddNotes: boolean;
}) {
  const { run, pending } = useActionToast();
  const [message, setMessage] = React.useState("");
  const [isInternal, setIsInternal] = React.useState(true);

  const submit = async () => {
    if (!message.trim()) return;
    const result = await run(() => addOrderNoteAction(orderId, { message: message.trim(), isInternal }));
    if (result.ok) setMessage("");
  };

  const timeline: TimelineEvent[] = events.map((event) => ({
    id: event.id,
    title: event.message,
    description: event.actor ? `${event.actor.name ?? event.actor.email}` : undefined,
    at: event.createdAt,
    tone: EVENT_TONE[event.type] ?? "neutral",
    icon: EVENT_ICON[event.type] ?? FileText,
    isInternal: event.isInternal,
  }));

  return (
    <section className="surface overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <h2 className="text-xs font-semibold tracking-tight">Timeline</h2>
        <span className="text-muted-foreground text-[11px]">{events.length} events</span>
      </header>

      {canAddNotes ? (
        <div className="space-y-2 border-b p-4">
          <Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={2}
            placeholder="Add a note about this order…"
            aria-label="Order note"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Switch id="note-internal" checked={isInternal} onCheckedChange={setIsInternal} />
              <Label htmlFor="note-internal" className="text-xs">
                {isInternal ? "Internal only" : "Visible to the customer"}
              </Label>
            </div>
            <Button size="sm" onClick={() => void submit()} disabled={pending || message.trim().length === 0}>
              Add note
            </Button>
          </div>
        </div>
      ) : null}

      <div className="p-4">
        <StatusTimeline events={timeline} emptyText="Nothing has happened on this order yet." />
      </div>
    </section>
  );
}
