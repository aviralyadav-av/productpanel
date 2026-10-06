import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound } from "lucide-react";

import { getSettingString } from "@/lib/settings";
import { AuthShell } from "@/components/layout/auth-shell";
import { ForgotPasswordForm } from "@/features/account/components/forgot-password-form";

export const metadata: Metadata = { title: "Forgot password" };

export default async function ForgotPasswordPage() {
  const storeName = (await getSettingString("store.name")) || "DIY Baazar";

  return (
    <AuthShell
      storeName={storeName}
      icon={KeyRound}
      title="Reset your password"
      description="Enter the email you sign in with. If it belongs to an administrator we will send a link that works for 30 minutes."
      footer={
        <p className="text-muted-foreground text-center text-xs">
          <Link href="/admin/login" className="hover:text-foreground underline-offset-2 hover:underline">
            Back to sign in
          </Link>
        </p>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
