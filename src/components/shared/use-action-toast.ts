"use client";

import * as React from "react";
import { toast } from "sonner";

import type { ActionResult } from "@/lib/action-result";

/**
 * Runs a Server Action inside a transition and turns its ActionResult into a
 * toast. Every mutation in the admin goes through it, so success and failure
 * are reported the same way everywhere: a green toast with the action's own
 * message, or a red one with its error sentence.
 *
 * `run` returns the result as well, so callers that need the data (a created
 * id to navigate to, field errors to show inline) can await it:
 *
 *   const { pending, run } = useActionToast();
 *   const result = await run(() => createCoupon(values), {
 *     onSuccess: (coupon) => router.push(`/admin/coupons/${coupon.id}`),
 *   });
 *   if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
 *
 * The transition keeps the UI responsive while revalidatePath re-renders the
 * page underneath, which is why this is not a plain useState(loading).
 */
export function useActionToast() {
  const [pending, startTransition] = React.useTransition();

  const run = React.useCallback(
    <T,>(
      action: () => Promise<ActionResult<T>>,
      options?: {
        onSuccess?: (data: T, result: Extract<ActionResult<T>, { ok: true }>) => void;
        onError?: (result: Extract<ActionResult<T>, { ok: false }>) => void;
        /** Shown when the action succeeds without a message of its own. */
        successMessage?: string;
        /** Suppress the success toast (e.g. for silent autosave). */
        silent?: boolean;
      },
    ): Promise<ActionResult<T>> =>
      new Promise((resolve) => {
        startTransition(async () => {
          let result: ActionResult<T>;
          try {
            result = await action();
          } catch (error) {
            console.error("ACTION THREW", error);
            result = {
              ok: false,
              error: "Something went wrong. The change was not saved.",
            };
          }

          if (result.ok) {
            const message = result.message ?? options?.successMessage;
            if (message && !options?.silent) toast.success(message);
            options?.onSuccess?.(result.data, result);
          } else {
            toast.error(result.error);
            options?.onError?.(result);
          }
          resolve(result);
        });
      }),
    [],
  );

  return { pending, run };
}
