import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, KeyRound } from "lucide-react";

import { getSettingString } from "@/lib/settings";
import { inspectResetToken } from "@/features/account/password-reset";
import { AuthShell } from "@/components/layout/auth-shell";
import { ResetPasswordForm } from "@/features/account/components/reset-password-form";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Choose a new password" };

const DEAD_LINK: Record<"invalid" | "expired" | "used", string> = {
  invalid: "This reset link is not valid. It may have been copied incompletely.",
  expired: "This reset link has expired. Links work for 30 minutes.",
  used: "This reset link has already been used.",
};

export default async function ResetPasswordPage({
  params,
}: PageProps<"/admin/reset-password/[token]">) {
  const { token } = await params;
  const [storeName, check] = await Promise.all([
    getSettingString("store.name"),
    inspectResetToken(token),
  ]);

  return (
    <AuthShell
      storeName={storeName || "DIY Baazar"}
      icon={KeyRound}
      title="Choose a new password"
      description={
        check.ok
          ? `Setting a new password for ${check.email}. Every other signed-in device will be signed out.`
          : undefined
      }
      footer={
        <p className="text-muted-foreground text-center text-xs">
          <Link href="/admin/login" className="hover:text-foreground underline-offset-2 hover:underline">
            Back to sign in
          </Link>
        </p>
      }
    >
      {check.ok ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="space-y-4 text-xs leading-relaxed">
          <div
            role="alert"
            className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border p-3"
          >
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            <span>{DEAD_LINK[check.reason]}</span>
          </div>
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link href="/admin/forgot-password">Request a new link</Link>
          </Button>
        </div>
      )}
    </AuthShell>
  );
}
