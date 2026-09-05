import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

function safeCallback(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const callbackUrl = safeCallback(params.callbackUrl);
  const showSeedHint = process.env.NODE_ENV === "development";

  return (
    <main className="bg-background flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md text-sm font-semibold">
            N
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">Niya Bags</p>
            <p className="text-muted-foreground text-xs leading-tight">
              Admin panel
            </p>
          </div>
        </div>

        <div className="surface p-6">
          <div className="mb-5 space-y-1">
            <h1 className="text-base font-semibold tracking-tight">
              Sign in
            </h1>
            <p className="text-muted-foreground text-xs">
              Administrator access only.
            </p>
          </div>

          <LoginForm callbackUrl={callbackUrl} />
        </div>

        {showSeedHint ? (
          <div className="text-muted-foreground mt-4 rounded-md border border-dashed p-3 text-[11px] leading-relaxed">
            <p className="text-foreground mb-1 font-medium">
              Development seed accounts
            </p>
            <p>
              <span className="font-mono">admin@niyabags.com</span> ·{" "}
              <span className="font-mono">Admin@12345</span> — full access
            </p>
            <p className="mt-0.5">
              <span className="font-mono">customer@example.com</span> ·{" "}
              <span className="font-mono">Customer@12345</span> — signs in, then
              gets refused. That is the authorization check working.
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
