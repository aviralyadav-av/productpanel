import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { getSettingString } from "@/lib/settings";
import { safeCallbackPath } from "@/features/account/redirects";
import { AuthShell } from "@/components/layout/auth-shell";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const REASONS: Record<string, string> = {
  "2fa_locked": "Too many incorrect two-factor codes. That session was closed - sign in again to retry.",
  session_ended: "Your session ended. Sign in again to continue.",
};

export default async function LoginPage({ searchParams }: PageProps<"/admin/login">) {
  const params = await searchParams;
  const callbackUrl = safeCallbackPath(params.callbackUrl);
  const reasonKey = Array.isArray(params.reason) ? params.reason[0] : params.reason;
  const reason = reasonKey ? REASONS[reasonKey] : undefined;
  const storeName = (await getSettingString("store.name")) || "DIY Baazar";
  const showSeedHint = process.env.NODE_ENV === "development";

  return (
    <AuthShell
      storeName={storeName}
      title="Sign in"
      description="Administrator access only. Every sign-in is recorded."
      footer={
        showSeedHint ? (
          <div className="text-muted-foreground rounded-md border border-dashed p-3 text-[11px] leading-relaxed">
            <p className="text-foreground mb-1 font-medium">Development seed account</p>
            <p>
              <span className="font-mono">{process.env.SEED_ADMIN_EMAIL ?? "admin@diybaazar.local"}</span> ·{" "}
              <span className="font-mono">{process.env.SEED_ADMIN_PASSWORD ?? "Admin@123456"}</span> — super-admin
            </p>
          </div>
        ) : null
      }
    >
      {reason ? (
        <div className="border-warning/30 bg-warning-muted/50 text-foreground mb-4 flex items-start gap-2 rounded-md border p-3 text-xs">
          <ShieldAlert className="text-warning mt-px size-3.5 shrink-0" />
          <span>{reason}</span>
        </div>
      ) : null}

      <LoginForm callbackUrl={callbackUrl} />

      <p className="text-muted-foreground mt-4 text-center text-xs">
        <Link href="/admin/forgot-password" className="hover:text-foreground underline-offset-2 hover:underline">
          Forgot your password?
        </Link>
      </p>
    </AuthShell>
  );
}
