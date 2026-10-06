"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";

/**
 * Copies `value` to the clipboard and confirms with a tick for two seconds.
 * For ids, SKUs, tracking numbers and API keys - anything an operator would
 * otherwise select by hand and get one character wrong.
 */
export function CopyButton({
  value,
  label = "Copy",
  size = "icon-xs",
  variant = "ghost",
  className,
  children,
}: {
  value: string;
  label?: string;
  size?: "icon-xs" | "icon-sm" | "xs" | "sm";
  variant?: "ghost" | "outline";
  className?: string;
  /** Visible text for the non-icon sizes. */
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard blocked (insecure context, permissions). Fall back to a
      // selection the operator can copy manually.
      window.prompt("Copy to clipboard:", value);
    }
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      className={cn("text-muted-foreground hover:text-foreground", className)}
      onClick={copy}
    >
      {copied ? <Check className="text-success" /> : <Copy />}
      {children}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </Button>
  );
}
