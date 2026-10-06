import Link from "next/link";
import { LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Rendered with a 401 when a guard calls `unauthorized()` (Next
 * authInterrupts). The guards normally redirect to /admin/login instead, so
 * this is the backstop for a session that expired mid-render.
 */
export default function Unauthorized() {
  return (
    <main className="bg-background flex min-h-svh flex-col items-center justify-center p-6 text-center">
      <div className="bg-muted text-muted-foreground mb-4 flex size-10 items-center justify-center rounded-full">
        <LogIn className="size-5" />
      </div>
      <h1 className="text-base font-semibold tracking-tight">Sign in to continue</h1>
      <p className="text-muted-foreground mt-2 max-w-sm text-xs leading-relaxed">
        Your session has ended or was signed out from another device.
      </p>
      <Button asChild size="sm" className="mt-5">
        <Link href="/admin/login">Go to sign in</Link>
      </Button>
    </main>
  );
}
