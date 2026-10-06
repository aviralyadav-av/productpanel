"use client";

import * as React from "react";
import { ExternalLink } from "lucide-react";

import { createPartnerAction, updatePartnerAction } from "@/features/shipping/actions";
import type { PartnerRow } from "@/features/shipping/queries";
import { TRACKING_PLACEHOLDER, buildTrackingUrl, trackingTemplateProblem } from "@/features/shipping/tracking";
import { FormActions } from "@/components/shared/form-actions";
import { FormRow, FormRowGroup } from "@/components/shared/form-layout";
import { NumberStepper } from "@/components/shared/number-stepper";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

const SAMPLE = "AWB123456789";

export function PartnerDialog({ partner, open, onOpenChange }: { partner: PartnerRow | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { pending, run } = useActionToast();
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const [name, setName] = React.useState(partner?.name ?? "");
  const [code, setCode] = React.useState(partner?.code ?? "");
  const [codeTouched, setCodeTouched] = React.useState(Boolean(partner));
  const [template, setTemplate] = React.useState(partner?.trackingUrlTemplate ?? "");
  const [phone, setPhone] = React.useState(partner?.phone ?? "");
  const [email, setEmail] = React.useState(partner?.email ?? "");
  const [website, setWebsite] = React.useState(partner?.website ?? "");
  const [isActive, setIsActive] = React.useState(partner?.isActive ?? true);
  const [position, setPosition] = React.useState(partner?.position ?? 0);

  // Code follows the name until the operator edits it, the way SlugInput does
  // for slugs; partner codes are upper-case identifiers, not URL slugs.
  function onNameChange(value: string) {
    setName(value);
    if (!codeTouched) setCode(value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32));
  }

  const templateProblem = trackingTemplateProblem(template);
  const preview = templateProblem ? null : buildTrackingUrl({ trackingUrlTemplate: template }, SAMPLE);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (templateProblem) return;
    setErrors({});
    const input = { code, name, trackingUrlTemplate: template || null, phone: phone || null, email: email || null, website: website || null, isActive, position };
    const result = await run(() => (partner ? updatePartnerAction(partner.id, input) : createPartnerAction(input)), {
      onSuccess: () => onOpenChange(false),
    });
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{partner ? `Edit partner: ${partner.name}` : "New shipping partner"}</DialogTitle>
          <DialogDescription>Couriers you hand shipments to. The tracking template turns a tracking number into the link shoppers click.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormRowGroup columns={2}>
            <FormRow label="Name" htmlFor="partner-name" required error={errors.name}>
              <Input id="partner-name" value={name} onChange={(event) => onNameChange(event.target.value)} maxLength={80} autoFocus required />
            </FormRow>
            <FormRow label="Code" htmlFor="partner-code" required hint="Unique identifier used in integrations and exports." error={errors.code}>
              <Input
                id="partner-code"
                value={code}
                onChange={(event) => {
                  setCodeTouched(true);
                  setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32));
                }}
                className="font-mono uppercase"
                maxLength={32}
                required
              />
            </FormRow>
          </FormRowGroup>

          <FormRow
            label="Tracking URL template"
            htmlFor="partner-template"
            hint={
              preview ? (
                <span className="inline-flex items-center gap-1">
                  Preview for {SAMPLE}:{" "}
                  <a href={preview} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline">
                    {preview.length > 60 ? `${preview.slice(0, 60)}…` : preview} <ExternalLink className="size-3" />
                  </a>
                </span>
              ) : (
                `Use ${TRACKING_PLACEHOLDER} where the tracking number goes.`
              )
            }
            error={errors.trackingUrlTemplate ?? (template ? templateProblem ?? undefined : undefined)}
          >
            <Input id="partner-template" value={template} onChange={(event) => setTemplate(event.target.value)} placeholder={`https://courier.example/track?awb=${TRACKING_PLACEHOLDER}`} className="font-mono text-xs" />
          </FormRow>

          <FormRowGroup columns={2}>
            <FormRow label="Support phone" htmlFor="partner-phone" error={errors.phone}>
              <Input id="partner-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+91 …" />
            </FormRow>
            <FormRow label="Support email" htmlFor="partner-email" error={errors.email}>
              <Input id="partner-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </FormRow>
          </FormRowGroup>

          <FormRow label="Website" htmlFor="partner-website" error={errors.website}>
            <Input id="partner-website" type="url" value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="https://" />
          </FormRow>

          <FormRowGroup columns={2}>
            <FormRow label="Active" htmlFor="partner-active" inline hint="Inactive partners are hidden when creating shipments." error={errors.isActive}>
              <Switch id="partner-active" checked={isActive} onCheckedChange={setIsActive} />
            </FormRow>
            <FormRow label="Position" htmlFor="partner-position" error={errors.position}>
              <NumberStepper id="partner-position" value={position} onChange={setPosition} min={0} max={100000} aria-label="Position" />
            </FormRow>
          </FormRowGroup>

          <FormActions dirty pending={pending} disabled={Boolean(templateProblem)} submitLabel={partner ? "Save partner" : "Add partner"} onCancel={() => onOpenChange(false)} warnOnLeave={false} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
