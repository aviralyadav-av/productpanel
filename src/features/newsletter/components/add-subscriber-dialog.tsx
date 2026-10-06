"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { NEWSLETTER_STATUSES, NEWSLETTER_STATUS_META, type NewsletterStatus } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormRow, FormRowGroup } from "@/components/shared/form-layout";
import { useActionToast } from "@/components/shared/use-action-toast";

import { addSubscriberAction } from "@/features/newsletter/actions";
import { COMMON_SOURCES } from "@/features/newsletter/schemas";

/**
 * Adding a subscriber by hand (a phone order, a stall at a fair). The consent
 * story matters: the default source is "admin" so an export can always tell an
 * address someone typed in from one that opted in on the storefront.
 */
const EMPTY = { email: "", name: "", source: "admin", status: "SUBSCRIBED" as NewsletterStatus };

export function AddSubscriberDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { run, pending } = useActionToast();
  const [values, setValues] = React.useState(EMPTY);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  function set<K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await run(() => addSubscriberAction(values), {
      onSuccess: () => {
        setValues(EMPTY);
        setErrors({});
        onOpenChange(false);
        router.refresh();
      },
      onError: (failure) => setErrors(failure.ok ? {} : (failure.fieldErrors ?? {})),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add a subscriber</DialogTitle>
            <DialogDescription>Only add addresses that agreed to hear from you. They can unsubscribe from any email.</DialogDescription>
          </DialogHeader>
          <FormRow label="Email" htmlFor="n-email" required error={errors.email}>
            <Input id="n-email" type="email" value={values.email} onChange={(event) => set("email", event.target.value)} maxLength={254} required autoFocus />
          </FormRow>
          <FormRow label="Name" htmlFor="n-name" error={errors.name}>
            <Input id="n-name" value={values.name} onChange={(event) => set("name", event.target.value)} maxLength={120} />
          </FormRow>
          <FormRowGroup columns={2}>
            <FormRow label="Source" htmlFor="n-source" hint="Where they signed up" error={errors.source}>
              <Input id="n-source" list="newsletter-sources" value={values.source} onChange={(event) => set("source", event.target.value)} maxLength={40} />
              <datalist id="newsletter-sources">
                {COMMON_SOURCES.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </FormRow>
            <FormRow label="Status" htmlFor="n-status" error={errors.status}>
              <select
                id="n-status"
                className="border-input bg-background h-8 w-full rounded-md border px-2 text-xs"
                value={values.status}
                onChange={(event) => set("status", event.target.value as NewsletterStatus)}
              >
                {NEWSLETTER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {NEWSLETTER_STATUS_META[status].label}
                  </option>
                ))}
              </select>
            </FormRow>
          </FormRowGroup>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || values.email.trim().length === 0}>
              {pending ? "Saving…" : "Add subscriber"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddSubscriberButton() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus />
        Add subscriber
      </Button>
      <AddSubscriberDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
