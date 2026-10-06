"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { ImageIcon, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormActions } from "@/components/shared/form-actions";
import { FormRow, FormRowGroup, FormSection } from "@/components/shared/form-layout";
import { useMediaPicker, type PickedAsset } from "@/components/shared/media-picker";
import { PercentInput } from "@/components/shared/percent-input";
import { usePermission } from "@/components/shared/permission-gate";
import { SlugInput } from "@/components/shared/slug-input";
import { useActionToast } from "@/components/shared/use-action-toast";

import { createSellerAction, updateSellerAction } from "@/features/sellers/actions";
import { INITIAL_SELLER_STATUSES, type InitialSellerStatus, type SellerProfileInput } from "@/features/sellers/schemas";
import type { SellerDetail } from "@/features/sellers/types";

/**
 * Create and edit share one form: the profile block is identical, and only a
 * new seller gets the "initial status" and "commission override" rows (an
 * existing seller changes those on their own tabs, where the audit trail is).
 *
 * Validation is server-side (Zod in the action); field errors come back keyed
 * by field and land under the matching input.
 */

type MediaValue = { id: string; url: string; alt: string | null } | null;

type FormState = {
  displayName: string;
  slug: string;
  legalName: string;
  ownerName: string;
  email: string;
  phone: string;
  description: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pinCode: string;
  gstin: string;
  pan: string;
  logo: MediaValue;
  banner: MediaValue;
  initialStatus: InitialSellerStatus;
  commissionBps: number | null;
};

function initialState(seller?: SellerDetail): FormState {
  return {
    displayName: seller?.displayName ?? "",
    slug: seller?.slug ?? "",
    legalName: seller?.legalName ?? "",
    ownerName: seller?.ownerName ?? "",
    email: seller?.email ?? "",
    phone: seller?.phone ?? "",
    description: seller?.description ?? "",
    addressLine1: seller?.addressLine1 ?? "",
    addressLine2: seller?.addressLine2 ?? "",
    city: seller?.city ?? "",
    state: seller?.state ?? "",
    pinCode: seller?.pinCode ?? "",
    gstin: seller?.gstin ?? "",
    pan: seller?.pan ?? "",
    logo: seller?.logo ? { id: seller.logo.id, url: seller.logo.thumbnailUrl ?? seller.logo.url, alt: seller.logo.alt } : null,
    banner: seller?.banner ? { id: seller.banner.id, url: seller.banner.thumbnailUrl ?? seller.banner.url, alt: seller.banner.alt } : null,
    initialStatus: "PENDING",
    commissionBps: null,
  };
}

function toProfile(state: FormState): SellerProfileInput {
  return {
    displayName: state.displayName,
    slug: state.slug,
    legalName: state.legalName,
    ownerName: state.ownerName,
    email: state.email,
    phone: state.phone,
    description: state.description,
    addressLine1: state.addressLine1,
    addressLine2: state.addressLine2,
    city: state.city,
    state: state.state,
    pinCode: state.pinCode,
    country: "IN",
    gstin: state.gstin,
    pan: state.pan,
    logoMediaId: state.logo?.id ?? null,
    bannerMediaId: state.banner?.id ?? null,
  };
}

/** Field errors arrive as "profile.slug" from the action; the form knows them as "slug". */
function stripPrefix(errors: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(errors ?? {})) out[key.replace(/^profile\./, "")] = message;
  return out;
}

export function SellerForm({ seller }: { seller?: SellerDetail }) {
  const router = useRouter();
  const picker = useMediaPicker();
  const { pending, run } = useActionToast();
  const canManageCommission = usePermission("commissions.manage");
  const [state, setState] = React.useState<FormState>(() => initialState(seller));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [dirty, setDirty] = React.useState(false);
  const isEdit = Boolean(seller);

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  async function pick(key: "logo" | "banner") {
    const picked = await picker.open({ accept: "image", multiple: false, title: key === "logo" ? "Choose a logo" : "Choose a banner" });
    const asset: PickedAsset | undefined = picked?.[0];
    if (asset) patch(key, { id: asset.id, url: asset.thumbnailUrl ?? asset.url, alt: asset.alt });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    const profile = toProfile(state);
    const result = seller
      ? await run(() => updateSellerAction({ id: seller.id, profile }), { onSuccess: () => setDirty(false) })
      : await run(
          () =>
            createSellerAction({
              profile,
              initialStatus: state.initialStatus,
              commissionBps: canManageCommission ? state.commissionBps : null,
            }),
          { onSuccess: (data) => router.push(`/admin/sellers/${data.id}` as Route) },
        );
    if (!result.ok && result.fieldErrors) setErrors(stripPrefix(result.fieldErrors));
  }

  const text = (key: keyof FormState, extra: Partial<React.ComponentProps<typeof Input>> = {}) => (
    <Input
      id={key}
      value={state[key] as string}
      onChange={(event) => patch(key, event.target.value as never)}
      aria-invalid={Boolean(errors[key])}
      disabled={pending}
      {...extra}
    />
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <FormSection title="Shop" description="What customers see on the storefront profile.">
        <FormRowGroup>
          <FormRow label="Display name" htmlFor="displayName" required error={errors.displayName}>
            {text("displayName", { maxLength: 120, autoFocus: !isEdit })}
          </FormRow>
          <FormRow label="Slug" htmlFor="slug" required error={errors.slug} hint="Public URL: /sellers/<slug>">
            <SlugInput
              id="slug"
              sourceValue={state.displayName}
              value={state.slug}
              onChange={(slug) => patch("slug", slug)}
              locked={isEdit}
              prefix="/sellers/"
              disabled={pending}
              invalid={Boolean(errors.slug)}
            />
          </FormRow>
        </FormRowGroup>
        <FormRow label="Description" htmlFor="description" error={errors.description} hint="Shown on the seller page. Plain text or simple HTML.">
          <Textarea id="description" rows={4} value={state.description} onChange={(event) => patch("description", event.target.value)} disabled={pending} />
        </FormRow>
        <FormRowGroup>
          <MediaField label="Logo" value={state.logo} onPick={() => pick("logo")} onClear={() => patch("logo", null)} error={errors.logoMediaId} disabled={pending} />
          <MediaField label="Banner" value={state.banner} onPick={() => pick("banner")} onClear={() => patch("banner", null)} error={errors.bannerMediaId} disabled={pending} wide />
        </FormRowGroup>
      </FormSection>

      <FormSection title="Business & contact" description="Legal identity and how the marketplace reaches the seller.">
        <FormRowGroup>
          <FormRow label="Legal name" htmlFor="legalName" error={errors.legalName}>
            {text("legalName", { maxLength: 200 })}
          </FormRow>
          <FormRow label="Owner name" htmlFor="ownerName" required error={errors.ownerName}>
            {text("ownerName", { maxLength: 120 })}
          </FormRow>
        </FormRowGroup>
        <FormRowGroup>
          <FormRow label="Email" htmlFor="email" required error={errors.email} hint={isEdit ? "Also the seller's login." : undefined}>
            {text("email", { type: "email", autoComplete: "off" })}
          </FormRow>
          <FormRow label="Phone" htmlFor="phone" error={errors.phone} hint="Indian mobile; stored as +91XXXXXXXXXX.">
            {text("phone", { type: "tel", inputMode: "tel" })}
          </FormRow>
        </FormRowGroup>
        <FormRowGroup>
          <FormRow label="GSTIN" htmlFor="gstin" error={errors.gstin} hint="15 characters; leave blank if unregistered.">
            {text("gstin", { maxLength: 15, className: "font-mono uppercase" })}
          </FormRow>
          <FormRow label="PAN" htmlFor="pan" error={errors.pan} hint="10 characters, e.g. ABCDE1234F.">
            {text("pan", { maxLength: 10, className: "font-mono uppercase" })}
          </FormRow>
        </FormRowGroup>
      </FormSection>

      <FormSection title="Address" description="Pickup and correspondence address.">
        <FormRow label="Address line 1" htmlFor="addressLine1" error={errors.addressLine1}>
          {text("addressLine1", { maxLength: 200 })}
        </FormRow>
        <FormRow label="Address line 2" htmlFor="addressLine2" error={errors.addressLine2}>
          {text("addressLine2", { maxLength: 200 })}
        </FormRow>
        <FormRowGroup columns={3}>
          <FormRow label="City" htmlFor="city" error={errors.city}>
            {text("city", { maxLength: 80 })}
          </FormRow>
          <FormRow label="State" htmlFor="state" error={errors.state}>
            {text("state", { maxLength: 80 })}
          </FormRow>
          <FormRow label="PIN code" htmlFor="pinCode" error={errors.pinCode}>
            {text("pinCode", { maxLength: 6, inputMode: "numeric" })}
          </FormRow>
        </FormRowGroup>
      </FormSection>

      {!isEdit ? (
        <FormSection title="Onboarding" description="Where the seller starts and whether they get their own commission rate.">
          <FormRowGroup>
            <FormRow
              label="Initial status"
              htmlFor="initialStatus"
              hint="Pending goes through review; Active skips KYC and is live immediately."
            >
              <select
                id="initialStatus"
                className="border-input bg-background h-8 w-full rounded-md border px-2 text-sm shadow-xs"
                value={state.initialStatus}
                onChange={(event) => patch("initialStatus", event.target.value as InitialSellerStatus)}
                disabled={pending}
              >
                {INITIAL_SELLER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status === "PENDING" ? "Pending review" : "Active"}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow
              label="Commission override"
              htmlFor="commissionBps"
              error={errors.commissionBps}
              hint={canManageCommission ? "Leave blank to inherit the marketplace rate." : "Requires commissions.manage."}
            >
              <PercentInput
                id="commissionBps"
                valueBps={state.commissionBps}
                onChangeBps={(bps) => patch("commissionBps", bps)}
                disabled={pending || !canManageCommission}
                placeholder="inherit"
              />
            </FormRow>
          </FormRowGroup>
        </FormSection>
      ) : null}

      <FormActions
        dirty={dirty}
        pending={pending}
        submitLabel={isEdit ? "Save profile" : "Create seller"}
        onCancel={() => router.push((seller ? `/admin/sellers/${seller.id}` : "/admin/sellers") as Route)}
      />
      {picker.element}
    </form>
  );
}

function MediaField({
  label,
  value,
  onPick,
  onClear,
  error,
  disabled,
  wide,
}: {
  label: string;
  value: MediaValue;
  onPick: () => void;
  onClear: () => void;
  error?: string;
  disabled?: boolean;
  wide?: boolean;
}) {
  return (
    <FormRow label={label} error={error} hint="From the media library; referenced by id so a replaced file follows.">
      <div className="flex items-center gap-3">
        <div className={`bg-muted flex shrink-0 items-center justify-center overflow-hidden rounded-md border ${wide ? "h-14 w-28" : "size-14"}`}>
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element -- media URLs come from our own storage/S3; next/image would need a remote pattern per bucket
            <img src={value.url} alt={value.alt ?? label} className="size-full object-cover" />
          ) : (
            <ImageIcon className="text-muted-foreground/60 size-5" />
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Button type="button" variant="outline" size="sm" onClick={onPick} disabled={disabled}>
            {value ? "Replace" : "Choose image"}
          </Button>
          {value ? (
            <Button type="button" variant="ghost" size="xs" onClick={onClear} disabled={disabled}>
              <X />
              Remove
            </Button>
          ) : null}
        </div>
      </div>
    </FormRow>
  );
}
