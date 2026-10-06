import Link from "next/link";
import { FileQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Inside the shell so a dead link keeps the sidebar and the operator's place. */
export default function ShellNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
      <div className="bg-muted text-muted-foreground mb-4 flex size-10 items-center justify-center rounded-full">
        <FileQuestion className="size-5" />
      </div>
      <h1 className="text-base font-semibold tracking-tight">There is nothing at this address</h1>
      <p className="text-muted-foreground mt-2 max-w-sm text-xs leading-relaxed">
        The record may have been deleted, or the link was copied incompletely. Use the sidebar or
        press <kbd className="bg-muted rounded border px-1 font-mono text-[10px]">⌘K</kbd> to find
        what you were looking for.
      </p>
      <Button asChild variant="outline" size="sm" className="mt-5">
        <Link href="/admin/dashboard">Back to the dashboard</Link>
      </Button>
    </div>
  );
}
