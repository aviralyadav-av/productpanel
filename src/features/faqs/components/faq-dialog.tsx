"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useActionToast } from "@/components/shared/use-action-toast";

import { createFaqAction } from "../actions";
import { checkFaqDraft, newFaqDraft, type FaqDraft } from "../draft";
import { FaqFields } from "./faq-fields";

/**
 * "New FAQ" dialog. It is a dialog and not a page because a FAQ is four
 * fields: sending the operator to /admin/faqs/new and back would cost more
 * than it explains. On success the board refreshes and the new question
 * appears at the end of its group.
 */
export function NewFaqDialog({
  open,
  onOpenChange,
  groups,
  /** Pre-selected group when the dialog is opened from a group header. */
  defaultGroup,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: string[];
  defaultGroup?: string;
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [draft, setDraft] = React.useState<FaqDraft>(() => newFaqDraft(defaultGroup));
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // Re-seed each time the dialog opens so a cancelled draft never leaks into
  // the next question, and so the group header's "Add question" pre-fills.
  React.useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opening the dialog is the reset event
    setDraft(newFaqDraft(defaultGroup));
    setErrors({});
  }, [open, defaultGroup]);

  function patch(changes: Partial<FaqDraft>) {
    setDraft((current) => ({ ...current, ...changes }));
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(changes)) delete next[key];
      return next;
    });
  }

  async function submit() {
    const checked = checkFaqDraft(draft);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    const result = await run(() => createFaqAction(checked.input), {
      onSuccess: () => {
        onOpenChange(false);
        router.refresh();
      },
    });
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">New FAQ</DialogTitle>
          <DialogDescription className="text-xs">It joins the end of its group; drag it into place afterwards.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <FaqFields idPrefix="new-faq" values={draft} onChange={patch} groups={groups} errors={errors} disabled={pending} autoFocus />
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              Add question
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
