"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail, MailX, Send, StickyNote } from "lucide-react";
import { cn } from "cn";

import { formatIstDateTime } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { HtmlPreview } from "@/components/shared/html-preview";
import { PermissionGate } from "@/components/shared/permission-gate";
import { useActionToast } from "@/components/shared/use-action-toast";

import { addInquiryNoteAction, replyToInquiryAction } from "@/features/inquiries/actions";
import type { InquiryDetail } from "@/features/inquiries/types";

/**
 * The conversation: the original message, then public replies (emailed) and
 * internal notes (staff only, drawn with a lock and a tinted background so
 * nobody mistakes one for a customer-facing message).
 */
export function InquiryThread({ inquiry }: { inquiry: InquiryDetail }) {
  const router = useRouter();
  const { run, pending } = useActionToast();
  const [mode, setMode] = React.useState<"reply" | "note">("reply");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const action = mode === "reply" ? replyToInquiryAction : addInquiryNoteAction;
    await run(() => action({ inquiryId: inquiry.id, message }), {
      onSuccess: () => {
        setMessage("");
        setError(null);
        router.refresh();
      },
      onError: (failure) => setError(failure.ok ? null : failure.fieldErrors?.message ?? failure.error),
    });
  }

  return (
    <div className="space-y-4">
      <article className="surface p-4">
        <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">{inquiry.subject}</h2>
          <span className="text-muted-foreground text-[11px]" data-numeric>
            {formatIstDateTime(new Date(inquiry.createdAt))}
          </span>
        </header>
        <p className="text-muted-foreground mb-3 text-xs">
          From {inquiry.name} &lt;{inquiry.email}&gt;
          {inquiry.phone ? ` · ${inquiry.phone}` : ""}
        </p>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{inquiry.message}</p>
      </article>

      <ol className="space-y-3" aria-label="Replies and notes">
        {inquiry.replies.map((reply) => (
          <li key={reply.id} className={cn("rounded-md border p-3", reply.isInternal ? "border-warning/40 bg-warning-muted/40" : "bg-muted/30 ml-6")}>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1.5 font-medium">
                {reply.isInternal ? <Lock className="text-warning size-3" aria-label="Internal note" /> : reply.emailSent ? <Mail className="text-success size-3" aria-label="Emailed" /> : <MailX className="text-destructive size-3" aria-label="Email not queued" />}
                {reply.author ?? "Staff"}
                <span className="text-muted-foreground font-normal">{reply.isInternal ? "internal note" : reply.emailSent ? "emailed to the customer" : "reply (email not queued)"}</span>
              </span>
              <span className="text-muted-foreground" data-numeric>
                {formatIstDateTime(new Date(reply.createdAt))}
              </span>
            </div>
            <HtmlPreview html={reply.message} title={reply.isInternal ? "Internal note" : "Reply"} minHeight={32} />
          </li>
        ))}
      </ol>

      <PermissionGate require="inquiries.manage">
        <form onSubmit={submit} className="surface space-y-3 p-4">
          <div className="bg-muted inline-flex items-center gap-0.5 rounded-lg p-0.5" role="tablist" aria-label="Message type">
            {(["reply", "note"] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={mode === item}
                onClick={() => setMode(item)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
                  mode === item ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item === "reply" ? <Send className="size-3" /> : <StickyNote className="size-3" />}
                {item === "reply" ? "Reply by email" : "Internal note"}
              </button>
            ))}
          </div>
          <Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={6}
            maxLength={10000}
            aria-label={mode === "reply" ? "Reply" : "Internal note"}
            aria-invalid={Boolean(error)}
            placeholder={mode === "reply" ? `Hi ${inquiry.name.split(" ")[0]},` : "Notes for the team - the customer never sees these."}
            className={cn(mode === "note" && "border-warning/50")}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
              {error ?? (mode === "reply" ? `Sent to ${inquiry.email} with your name and the store signature; the inquiry moves to Replied.` : "Visible to staff only.")}
            </p>
            <Button type="submit" size="sm" disabled={pending || message.trim().length === 0}>
              {mode === "reply" ? <Send /> : <StickyNote />}
              {pending ? "Saving…" : mode === "reply" ? "Send reply" : "Add note"}
            </Button>
          </div>
        </form>
      </PermissionGate>
    </div>
  );
}
