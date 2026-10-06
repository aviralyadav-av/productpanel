"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { ArrowRight, Plus, Trash2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MultiSelect } from "@/components/shared/combobox";
import { FormActions } from "@/components/shared/form-actions";
import { FormRow, FormRowGroup, FormSection } from "@/components/shared/form-layout";
import { useActionToast } from "@/components/shared/use-action-toast";

import { saveFooterAction } from "../actions";
import { PAYMENT_ICON_OPTIONS, SOCIAL_PLATFORM_OPTIONS, footerFormSchema, type FooterEditorData, type FooterFormInput } from "../schemas";

/**
 * The FooterConfig editor (E1): brand blurb, copyright, social profiles,
 * customer-service block, legal links, payment icons and app-store links. The
 * three link COLUMNS are deliberately not here - they are NavigationMenus
 * `footer-1..3` and are edited under Navigation, which the pointer card says.
 */

type Draft = FooterFormInput;

function draftFrom(footer: FooterEditorData): Draft {
  return {
    brandName: footer.brandName,
    brandDescription: footer.brandDescription,
    copyright: footer.copyright,
    socialLinks: footer.socialLinks.map((link) => ({ ...link })),
    customerService: { ...footer.customerService },
    legalLinks: footer.legalLinks.map((link) => ({ ...link })),
    paymentIcons: [...footer.paymentIcons],
    appLinks: { ...footer.appLinks },
  };
}

export function FooterForm({ footer, canManage, menuCounts }: { footer: FooterEditorData; canManage: boolean; menuCounts: { slug: string; name: string; items: number }[] }) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [draft, setDraft] = React.useState<Draft>(() => draftFrom(footer));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [dirty, setDirty] = React.useState(false);
  const [seed, setSeed] = React.useState(footer.updatedAt);
  if (seed !== footer.updatedAt) {
    setSeed(footer.updatedAt);
    setDraft(draftFrom(footer));
    setDirty(false);
  }

  const update = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
  };
  const readOnly = !canManage;

  async function save() {
    const parsed = footerFormSchema.safeParse(draft);
    if (!parsed.success) {
      const flat: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        if (key && !flat[key]) flat[key] = issue.message;
      }
      setErrors(flat);
      return;
    }
    setErrors({});
    const result = await run(() => saveFooterAction(parsed.data), { onError: (failed) => setErrors(failed.fieldErrors ?? {}) });
    if (result.ok) {
      setDirty(false);
      router.refresh();
    }
  }

  const paymentOptions = [
    ...PAYMENT_ICON_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
    ...draft.paymentIcons.filter((value) => !PAYMENT_ICON_OPTIONS.some((option) => option.value === value)).map((value) => ({ value, label: value })),
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="space-y-6">
        <FormSection title="Brand" description="Shown in the footer's first column on every storefront page.">
          <FormRow label="Brand name" htmlFor="footer-brand" required error={errors.brandName}>
            <Input id="footer-brand" value={draft.brandName} onChange={(event) => update({ brandName: event.target.value })} disabled={readOnly} aria-invalid={Boolean(errors.brandName) || undefined} />
          </FormRow>
          <FormRow label="Description" htmlFor="footer-description" error={errors.brandDescription}>
            <Textarea id="footer-description" rows={3} value={draft.brandDescription} onChange={(event) => update({ brandDescription: event.target.value })} disabled={readOnly} />
          </FormRow>
          <FormRow label="Copyright line" htmlFor="footer-copyright" error={errors.copyright} hint="Rendered as-is; include the year yourself or let the website substitute it.">
            <Input id="footer-copyright" value={draft.copyright} onChange={(event) => update({ copyright: event.target.value })} disabled={readOnly} />
          </FormRow>
        </FormSection>

        <FormSection
          title="Social profiles"
          description="Profile URLs shown as icons. Store-wide social settings (Settings → Social) are sent alongside these as `social`."
          actions={
            canManage && draft.socialLinks.length < 12 ? (
              <Button size="xs" variant="outline" onClick={() => update({ socialLinks: [...draft.socialLinks, { platform: "", url: "" }] })}>
                <Plus /> Add
              </Button>
            ) : undefined
          }
        >
          {draft.socialLinks.length === 0 ? <p className="text-muted-foreground text-xs">No social links yet.</p> : null}
          {draft.socialLinks.map((link, index) => (
            <div key={index} className="flex items-start gap-2">
              <div className="w-40 shrink-0">
                <Select value={link.platform || undefined} onValueChange={(value) => update({ socialLinks: draft.socialLinks.map((row, i) => (i === index ? { ...row, platform: value } : row)) })} disabled={readOnly}>
                  <SelectTrigger aria-label="Platform" aria-invalid={Boolean(errors[`socialLinks.${index}.platform`]) || undefined} className="w-full">
                    <SelectValue placeholder="Platform" />
                  </SelectTrigger>
                  <SelectContent>
                    {SOCIAL_PLATFORM_OPTIONS.map((platform) => (
                      <SelectItem key={platform} value={platform}>
                        {platform.charAt(0).toUpperCase() + platform.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0 flex-1">
                <Input value={link.url} onChange={(event) => update({ socialLinks: draft.socialLinks.map((row, i) => (i === index ? { ...row, url: event.target.value } : row)) })} placeholder="https://instagram.com/diybaazar" disabled={readOnly} aria-label="Profile URL" aria-invalid={Boolean(errors[`socialLinks.${index}.url`]) || undefined} />
                {errors[`socialLinks.${index}.url`] || errors[`socialLinks.${index}.platform`] ? <p className="text-destructive mt-1 text-[11px]">{errors[`socialLinks.${index}.url`] ?? errors[`socialLinks.${index}.platform`]}</p> : null}
              </div>
              {canManage ? (
                <Button variant="ghost" size="icon-xs" aria-label="Remove social link" onClick={() => update({ socialLinks: draft.socialLinks.filter((_, i) => i !== index) })}>
                  <Trash2 className="text-destructive" />
                </Button>
              ) : null}
            </div>
          ))}
        </FormSection>

        <FormSection title="Customer service" description="The help block: a heading, one line of text and the support address.">
          <FormRowGroup columns={2}>
            <FormRow label="Heading" htmlFor="footer-cs-heading" error={errors["customerService.heading"]}>
              <Input id="footer-cs-heading" value={draft.customerService.heading} onChange={(event) => update({ customerService: { ...draft.customerService, heading: event.target.value } })} disabled={readOnly} />
            </FormRow>
            <FormRow label="Support email" htmlFor="footer-cs-email" error={errors["customerService.email"]} hint="Sent to the website as `supportEmail`.">
              <Input id="footer-cs-email" type="email" value={draft.customerService.email} onChange={(event) => update({ customerService: { ...draft.customerService, email: event.target.value } })} disabled={readOnly} aria-invalid={Boolean(errors["customerService.email"]) || undefined} />
            </FormRow>
          </FormRowGroup>
          <FormRow label="Text" htmlFor="footer-cs-description" error={errors["customerService.description"]}>
            <Textarea id="footer-cs-description" rows={2} value={draft.customerService.description} onChange={(event) => update({ customerService: { ...draft.customerService, description: event.target.value } })} disabled={readOnly} />
          </FormRow>
        </FormSection>

        <FormSection
          title="Legal links"
          description="The small print row: privacy, terms, returns. Site paths (/pages/privacy-policy) or full URLs."
          actions={
            canManage && draft.legalLinks.length < 10 ? (
              <Button size="xs" variant="outline" onClick={() => update({ legalLinks: [...draft.legalLinks, { label: "", path: "" }] })}>
                <Plus /> Add
              </Button>
            ) : undefined
          }
        >
          {draft.legalLinks.length === 0 ? <p className="text-muted-foreground text-xs">No legal links yet.</p> : null}
          {draft.legalLinks.map((link, index) => (
            <div key={index} className="flex items-start gap-2">
              <div className="w-40 shrink-0">
                <Input value={link.label} onChange={(event) => update({ legalLinks: draft.legalLinks.map((row, i) => (i === index ? { ...row, label: event.target.value } : row)) })} placeholder="Privacy policy" disabled={readOnly} aria-label="Label" aria-invalid={Boolean(errors[`legalLinks.${index}.label`]) || undefined} />
              </div>
              <div className="min-w-0 flex-1">
                <Input value={link.path} onChange={(event) => update({ legalLinks: draft.legalLinks.map((row, i) => (i === index ? { ...row, path: event.target.value } : row)) })} placeholder="/pages/privacy-policy" disabled={readOnly} aria-label="Path" className="font-mono" aria-invalid={Boolean(errors[`legalLinks.${index}.path`]) || undefined} />
                {errors[`legalLinks.${index}.path`] || errors[`legalLinks.${index}.label`] ? <p className="text-destructive mt-1 text-[11px]">{errors[`legalLinks.${index}.path`] ?? errors[`legalLinks.${index}.label`]}</p> : null}
              </div>
              {canManage ? (
                <Button variant="ghost" size="icon-xs" aria-label="Remove legal link" onClick={() => update({ legalLinks: draft.legalLinks.filter((_, i) => i !== index) })}>
                  <Trash2 className="text-destructive" />
                </Button>
              ) : null}
            </div>
          ))}
        </FormSection>

        <FormSection title="Payments and apps" description="Which payment marks to show, and the app-store badges.">
          <FormRow label="Payment icons" htmlFor="footer-payments" error={errors.paymentIcons} hint="Keys the website maps to artwork; pick the methods you actually accept.">
            <MultiSelect id="footer-payments" options={paymentOptions} value={draft.paymentIcons} onChange={(value) => update({ paymentIcons: value })} placeholder="Choose payment marks" disabled={readOnly} />
          </FormRow>
          <FormRowGroup columns={2}>
            <FormRow label="Google Play URL" htmlFor="footer-play" error={errors["appLinks.playStore"]}>
              <Input id="footer-play" value={draft.appLinks.playStore} onChange={(event) => update({ appLinks: { ...draft.appLinks, playStore: event.target.value } })} placeholder="https://play.google.com/store/apps/details?id=…" disabled={readOnly} aria-invalid={Boolean(errors["appLinks.playStore"]) || undefined} />
            </FormRow>
            <FormRow label="App Store URL" htmlFor="footer-appstore" error={errors["appLinks.appStore"]}>
              <Input id="footer-appstore" value={draft.appLinks.appStore} onChange={(event) => update({ appLinks: { ...draft.appLinks, appStore: event.target.value } })} placeholder="https://apps.apple.com/…" disabled={readOnly} aria-invalid={Boolean(errors["appLinks.appStore"]) || undefined} />
            </FormRow>
          </FormRowGroup>
        </FormSection>

        {canManage ? <FormActions dirty={dirty} pending={pending} onSubmit={save} submitLabel="Save footer" /> : null}
      </div>

      <aside className="space-y-3">
        <Alert>
          <AlertTitle>Link columns live in Navigation</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>The footer&apos;s link columns are the menus footer-1, footer-2 and footer-3. Edit their headings and links under Navigation; the website receives them in `menus`.</p>
            <ul className="text-xs">
              {menuCounts.map((menu) => (
                <li key={menu.slug} className="flex items-center justify-between gap-2 py-0.5">
                  <Link href={`/admin/navigation?menu=${encodeURIComponent(menu.slug)}` as Route} className="truncate hover:underline">
                    {menu.name}
                  </Link>
                  <span className="text-muted-foreground shrink-0" data-numeric>
                    {menu.items} link{menu.items === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
            <Button asChild size="xs" variant="outline">
              <Link href={"/admin/navigation?menu=footer-1" as Route}>
                Open Navigation <ArrowRight />
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
        <p className="text-muted-foreground text-[11px]">
          The website reads all of this from <code className="font-mono">GET /api/v1/footer</code>; changes appear after the public cache refreshes (about a minute).
        </p>
      </aside>
    </div>
  );
}
