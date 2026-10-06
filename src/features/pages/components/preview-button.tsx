"use client";

import * as React from "react";
import { ExternalLink, Loader2 } from "lucide-react";

import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { useActionToast } from "@/components/shared/use-action-toast";

/**
 * "Preview" for draft content (blueprint E6). Clicking mints a short-lived
 * token through the given action and opens the storefront URL in a new tab.
 * The tab is opened synchronously on click and navigated once the URL is
 * known, because browsers block `window.open` calls that happen after an
 * await - the classic popup-blocker trap.
 *
 * Shared by pages and blog; each passes its own action.
 */
export function PreviewButton({
  action,
  label = "Preview",
  size = "sm",
  disabled,
  variant = "outline",
}: {
  action: () => Promise<ActionResult<{ url: string; expiresAt: string }>>;
  label?: string;
  size?: "sm" | "xs" | "default";
  disabled?: boolean;
  variant?: "outline" | "ghost" | "default";
}) {
  const { pending, run } = useActionToast();

  async function open() {
    const tab = typeof window !== "undefined" ? window.open("about:blank", "_blank", "noopener") : null;
    const result = await run(action, { silent: true });
    if (result.ok) {
      if (tab) tab.location.href = result.data.url;
      else window.open(result.data.url, "_blank", "noopener");
    } else {
      tab?.close();
    }
  }

  return (
    <Button type="button" variant={variant} size={size} disabled={disabled || pending} onClick={() => void open()}>
      {pending ? <Loader2 className="animate-spin" /> : <ExternalLink />}
      {label}
    </Button>
  );
}
