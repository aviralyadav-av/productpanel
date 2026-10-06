"use server";

import { z } from "zod";

import { emailSchema } from "@/lib/validation";
import { completePasswordReset, requestPasswordReset } from "./password-reset";
import { requestMeta } from "./request-meta";

/**
 * Forgot / reset password form handlers (useActionState). Both are
 * anonymous: proxy.ts lets /admin/forgot-password and /admin/reset-password/*
 * through without a session. Neither reveals whether an email is registered.
 */

export type ForgotPasswordState = {
  status?: "sent" | "rate_limited";
  error?: string;
  retryAfterSec?: number;
};

const forgotSchema = z.object({ email: emailSchema });

export async function forgotPasswordAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const parsed = forgotSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: "Enter a valid email address." };

  const meta = await requestMeta();
  const result = await requestPasswordReset({ email: parsed.data.email, ...meta });

  if (result.status === "rate_limited") {
    return {
      status: "rate_limited",
      retryAfterSec: result.retryAfterSec,
      error: "Too many reset requests. Wait a while before trying again.",
    };
  }
  return { status: "sent" };
}

export type ResetPasswordState = {
  status?: "done" | "dead_link";
  error?: string;
  fieldErrors?: Partial<Record<"password" | "confirmPassword", string>>;
};

const resetSchema = z.object({
  token: z.string().min(16).max(128),
  password: z.string().min(1, "Enter a new password."),
  confirmPassword: z.string().min(1, "Repeat the new password."),
});

export async function resetPasswordAction(
  _prev: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const parsed = resetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    const fieldErrors: ResetPasswordState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === "password" || key === "confirmPassword") fieldErrors[key] ??= issue.message;
    }
    return Object.keys(fieldErrors).length > 0
      ? { fieldErrors }
      : { status: "dead_link", error: "This reset link is not valid." };
  }

  if (parsed.data.password !== parsed.data.confirmPassword) {
    return { fieldErrors: { confirmPassword: "These do not match." } };
  }

  const meta = await requestMeta();
  const result = await completePasswordReset({
    token: parsed.data.token,
    password: parsed.data.password,
    ...meta,
  });

  if (!result.ok) {
    if (result.reason === "weak_password") {
      return { error: result.message, fieldErrors: { password: result.message } };
    }
    if (result.reason === "rate_limited") return { error: result.message };
    return { status: "dead_link", error: result.message };
  }

  return { status: "done" };
}
