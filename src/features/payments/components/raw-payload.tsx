"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The gateway's own JSON, collapsed by default.
 *
 * A payload can carry signatures, card metadata and the customer's contact
 * details, so the server only sends it to an actor with `payments.manage`
 * (D4/D11) — this component never fetches it itself. It is rendered as text
 * inside a scroll box rather than an interactive tree: the point is to copy a
 * value into a gateway dashboard, not to browse it.
 */
export function RawPayloadViewer({ payload }: { payload: unknown }) {
  const [open, setOpen] = React.useState(false);
  const text = React.useMemo(() => {
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return String(payload);
    }
  }, [payload]);

  if (payload === null || payload === undefined) {
    return <p className="text-muted-foreground px-4 py-3 text-xs">No gateway payload was stored for this transaction.</p>;
  }

  return (
    <div className="p-4">
      <Button variant="outline" size="sm" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? <ChevronDown /> : <ChevronRight />}
        {open ? "Hide" : "Show"} raw payload
      </Button>
      {open ? (
        <pre className="bg-muted/40 mt-2 max-h-96 overflow-auto rounded border p-3 text-[11px] leading-relaxed whitespace-pre-wrap">
          {text}
        </pre>
      ) : null}
    </div>
  );
}
