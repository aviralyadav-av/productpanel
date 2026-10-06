"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type ConfirmPayload = { reason?: string };

export type ConfirmOptions = {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /**
   * The operator must type this exact string before the confirm button
   * enables. Reserved for the irreversible: deleting a seller, wiping a
   * category with products in it.
   */
  requireTypedText?: string;
  /**
   * Collect a reason with the confirmation. With `options` it is a select;
   * without, a free-text box. The reason lands in the audit log, which is why
   * cancellations and refunds ask for one.
   */
  requireReason?: { label: string; options?: string[]; placeholder?: string };
};

/**
 * The one confirmation dialog. Built on AlertDialog (modal, focus-trapped,
 * Escape cancels) with a pending state so a slow server action cannot be
 * confirmed twice, and two opt-in frictions for dangerous operations.
 *
 * `onConfirm` may return a promise; the dialog stays open and disabled until
 * it settles, then closes. If it throws, the dialog stays open so the caller's
 * toast can be read.
 *
 * @example
 *   <ConfirmDialog open={open} onOpenChange={setOpen} title="Delete 3 products?"
 *     destructive confirmLabel="Delete" requireReason={{ label: "Why?" }}
 *     onConfirm={({ reason }) => run(() => bulkDelete(ids, reason))} />
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  requireTypedText,
  requireReason,
  onConfirm,
}: ConfirmOptions & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: ConfirmPayload) => void | Promise<void>;
}) {
  const [typed, setTyped] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const typedId = React.useId();
  const reasonId = React.useId();

  // Reset the frictions every time the dialog opens so a previous "DELETE"
  // does not pre-arm the next one.
  React.useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting form state on open is the intended behaviour
      setTyped("");
      setReason("");
      setPending(false);
    }
  }, [open]);

  const typedOk = !requireTypedText || typed.trim() === requireTypedText;
  const reasonOk = !requireReason || reason.trim().length > 0;
  const canConfirm = typedOk && reasonOk && !pending;

  async function handleConfirm() {
    if (!canConfirm) return;
    setPending(true);
    try {
      await onConfirm({ reason: requireReason ? reason.trim() : undefined });
      onOpenChange(false);
    } catch {
      // The caller reports the failure; keep the dialog open.
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm">{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription className="text-xs">
              {description}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>

        {requireReason || requireTypedText ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              handleConfirm();
            }}
          >
            {requireReason ? (
              <div className="space-y-1.5">
                <Label htmlFor={reasonId} className="text-xs">
                  {requireReason.label}
                </Label>
                {requireReason.options ? (
                  <Select value={reason} onValueChange={setReason} disabled={pending}>
                    <SelectTrigger id={reasonId} size="sm" className="w-full">
                      <SelectValue placeholder={requireReason.placeholder ?? "Choose a reason"} />
                    </SelectTrigger>
                    <SelectContent>
                      {requireReason.options.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Textarea
                    id={reasonId}
                    rows={2}
                    value={reason}
                    disabled={pending}
                    placeholder={requireReason.placeholder ?? "Recorded in the audit log"}
                    onChange={(event) => setReason(event.target.value)}
                    className="text-xs"
                  />
                )}
              </div>
            ) : null}

            {requireTypedText ? (
              <div className="space-y-1.5">
                <Label htmlFor={typedId} className="text-xs">
                  Type <span className="font-mono font-semibold">{requireTypedText}</span> to confirm
                </Label>
                <Input
                  id={typedId}
                  value={typed}
                  disabled={pending}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setTyped(event.target.value)}
                  className="h-8 font-mono text-xs"
                />
              </div>
            ) : null}
          </form>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel size="sm" disabled={pending}>
            {cancelLabel}
          </AlertDialogCancel>
          {/* A plain Button rather than AlertDialogAction: Action closes the
              dialog on click, and we need it to stay open while pending. */}
          <Button
            type="button"
            size="sm"
            variant={destructive ? "destructive" : "default"}
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            {pending ? <Loader2 className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type ConfirmResult = { ok: true; reason?: string } | { ok: false };

/**
 * Imperative confirmation, for the many places where a confirm is one line in
 * an event handler rather than a piece of component state:
 *
 *   const [confirm, confirmDialog] = useConfirm();
 *   async function onDelete() {
 *     const result = await confirm({ title: "Delete this coupon?", destructive: true });
 *     if (!result.ok) return;
 *     run(() => deleteCoupon(id));
 *   }
 *   return <>{confirmDialog}<Button onClick={onDelete}>Delete</Button></>;
 *
 * Render `confirmDialog` once anywhere in the component's tree.
 */
export function useConfirm(): [
  (options: ConfirmOptions) => Promise<ConfirmResult>,
  React.ReactNode,
] {
  const [state, setState] = React.useState<{
    options: ConfirmOptions;
    resolve: (result: ConfirmResult) => void;
  } | null>(null);

  const confirm = React.useCallback(
    (options: ConfirmOptions) =>
      new Promise<ConfirmResult>((resolve) => setState({ options, resolve })),
    [],
  );

  const dialog = state ? (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) {
          state.resolve({ ok: false });
          setState(null);
        }
      }}
      {...state.options}
      onConfirm={({ reason }) => {
        state.resolve({ ok: true, reason });
        setState(null);
      }}
    />
  ) : null;

  return [confirm, dialog];
}
