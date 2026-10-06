import Link from "next/link";
import { ShieldOff } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Rendered with a 403 when a page guard calls `forbidden()` (blueprint
 * §14.D10, Next authInterrupts). The operator IS signed in; they just lack
 * the module's `*.view` permission. Also re-exported from (shell)/forbidden.tsx
 * so the same message appears inside the sidebar chrome.
 */
export default function Forbidden() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
      <div className="bg-warning-muted text-warning mb-4 flex size-10 items-center justify-center rounded-full">
        <ShieldOff className="size-5" />
      </div>
      <h1 className="text-base font-semibold tracking-tight">You do not have access to this module</h1>
      <p className="text-muted-foreground mt-2 max-w-sm text-xs leading-relaxed">
        Your role does not include permission to view this page. If you need it for your work, ask an
        administrator to extend your role - permissions are granted per role, not requested here.
      </p>
      <Button asChild variant="outline" size="sm" className="mt-5">
        <Link href="/admin/dashboard">Back to the dashboard</Link>
      </Button>
    </div>
  );
}
