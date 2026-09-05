import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";

import { getActor } from "@/lib/auth/guards";
import { signOutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "No access" };

export default async function UnauthorizedPage() {
  const actor = await getActor();

  return (
    <main className="bg-background flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <div className="bg-warning-muted text-warning mx-auto mb-4 flex size-10 items-center justify-center rounded-full">
          <ShieldAlert className="size-5" />
        </div>

        <h1 className="text-base font-semibold tracking-tight">
          This account cannot open the admin panel
        </h1>

        <p className="text-muted-foreground mx-auto mt-2 max-w-sm text-xs leading-relaxed">
          {actor ? (
            <>
              You are signed in as{" "}
              <span className="text-foreground font-medium">{actor.email}</span>
              , which is a customer account. Admin access is granted per account
              by an existing administrator — it is not something you can request
              from this screen.
            </>
          ) : (
            <>Your session has ended. Sign in again to continue.</>
          )}
        </p>

        <form action={signOutAction} className="mt-6">
          <Button type="submit" variant="outline" size="sm">
            Sign in with a different account
          </Button>
        </form>
      </div>
    </main>
  );
}
