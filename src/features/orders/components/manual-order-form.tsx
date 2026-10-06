"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Loader2, Tag, Truck } from "lucide-react";

import { PAYMENT_METHODS, PAYMENT_METHOD_META, type PaymentMethod } from "@/lib/enums";
import { formatPaise } from "@/lib/money";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/shared/combobox";
import { EntityPicker, type EntityRef } from "@/components/shared/entity-picker";
import { FormActions } from "@/components/shared/form-actions";
import { FormSection } from "@/components/shared/form-layout";
import { useActionToast } from "@/components/shared/use-action-toast";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

import { createManualOrderAction, loadOrderProductAction, previewOrderDraftAction } from "../actions";
import type { OrderDraft } from "../draft";
import type { ManualOrderInput } from "../schemas";
import { ManualOrderItems, emptyLine, type ManualLineState } from "./manual-order-items";

/**
 * /admin/orders/new (blueprint §10 createManualOrder, §11.8, §14.C3).
 *
 * A phone order and a website order must cost the same, so this form never
 * computes a total: it sends the basket to `previewOrderDraftAction`, which
 * runs the identical pricing core the checkout runs, and shows what comes
 * back. The only thing an operator can bend is the unit price - and only on a
 * MANUAL order, only with a reason, and it is written to the timeline.
 */

type AddressState = {
  fullName: string;
  phone: string;
  email: string;
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  state: string;
  pinCode: string;
  country: string;
};

const EMPTY_ADDRESS: AddressState = {
  fullName: "",
  phone: "",
  email: "",
  line1: "",
  line2: "",
  landmark: "",
  city: "",
  state: "",
  pinCode: "",
  country: "IN",
};

type PincodeCheck = { serviceable: boolean; codAvailable: boolean; city: string | null; state: string | null; estimatedDays: number } | null;

function AddressFields({
  legend,
  values,
  onChange,
  check,
}: {
  legend: string;
  values: AddressState;
  onChange: (patch: Partial<AddressState>) => void;
  check?: PincodeCheck;
}) {
  const field = (key: keyof AddressState) => (event: React.ChangeEvent<HTMLInputElement>) => onChange({ [key]: event.target.value });
  const id = (key: string) => `${legend.toLowerCase()}-${key}`;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <Label htmlFor={id("name")} className="text-xs">
          Recipient
        </Label>
        <Input id={id("name")} value={values.fullName} onChange={field("fullName")} autoComplete="off" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={id("phone")} className="text-xs">
          Phone
        </Label>
        <Input id={id("phone")} value={values.phone} onChange={field("phone")} inputMode="tel" autoComplete="off" />
      </div>
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor={id("line1")} className="text-xs">
          Address line 1
        </Label>
        <Input id={id("line1")} value={values.line1} onChange={field("line1")} autoComplete="off" />
      </div>
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor={id("line2")} className="text-xs">
          Address line 2
        </Label>
        <Input id={id("line2")} value={values.line2} onChange={field("line2")} autoComplete="off" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={id("landmark")} className="text-xs">
          Landmark
        </Label>
        <Input id={id("landmark")} value={values.landmark} onChange={field("landmark")} autoComplete="off" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={id("pin")} className="text-xs">
          PIN code
        </Label>
        <Input id={id("pin")} value={values.pinCode} onChange={field("pinCode")} inputMode="numeric" maxLength={6} autoComplete="off" />
        {check ? (
          <p className={check.serviceable ? "text-success text-[11px]" : "text-destructive text-[11px]"}>
            {check.serviceable
              ? `Serviceable${check.city ? ` · ${check.city}` : ""} · ${check.estimatedDays} day${check.estimatedDays === 1 ? "" : "s"}${check.codAvailable ? " · COD available" : " · no COD"}`
              : "We do not deliver to this PIN code."}
          </p>
        ) : null}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={id("city")} className="text-xs">
          City
        </Label>
        <Input id={id("city")} value={values.city} onChange={field("city")} autoComplete="off" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={id("state")} className="text-xs">
          State
        </Label>
        <Input id={id("state")} value={values.state} onChange={field("state")} autoComplete="off" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={id("email")} className="text-xs">
          Email (optional)
        </Label>
        <Input id={id("email")} value={values.email} onChange={field("email")} type="email" autoComplete="off" />
      </div>
    </div>
  );
}

export function ManualOrderForm() {
  const router = useRouter();
  const { run, pending } = useActionToast();

  const [customer, setCustomer] = React.useState<EntityRef | null>(null);
  const [newCustomer, setNewCustomer] = React.useState({ email: "", name: "", phone: "" });
  const [shipping, setShipping] = React.useState<AddressState>(EMPTY_ADDRESS);
  const [billingSame, setBillingSame] = React.useState(true);
  const [billing, setBilling] = React.useState<AddressState>(EMPTY_ADDRESS);
  const [lines, setLines] = React.useState<ManualLineState[]>(() => [emptyLine()]);
  const [couponCode, setCouponCode] = React.useState("");
  const [shippingRateId, setShippingRateId] = React.useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod>("COD");
  const [customerNote, setCustomerNote] = React.useState("");
  const [internalNote, setInternalNote] = React.useState("");
  const [draft, setDraft] = React.useState<OrderDraft | null>(null);
  const [pricing, setPricing] = React.useState(false);
  const [check, setCheck] = React.useState<PincodeCheck>(null);

  // ---- product pick -> variants, options -----------------------------------
  const pickProduct = async (key: string, ref: EntityRef | null) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, product: ref, info: null, variantId: null, answers: {}, error: null, loading: ref !== null } : line)));
    if (!ref) return;
    const result = await loadOrderProductAction(ref.id);
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        if (!result.ok) return { ...line, loading: false, error: result.error };
        const info = result.data;
        const preferred = info.variants.find((variant) => variant.isDefault) ?? info.variants[0] ?? null;
        return { ...line, loading: false, error: null, info, variantId: preferred?.id ?? null, quantity: Math.max(line.quantity, info.minOrderQty) };
      }),
    );
  };

  // ---- serviceability ------------------------------------------------------
  const pin = shipping.pinCode.trim();
  React.useEffect(() => {
    let cancelled = false;
    // Everything that touches state happens in the timer callback, never in
    // the effect body: a synchronous setState here would cascade a render on
    // every keystroke.
    const timer = setTimeout(async () => {
      if (pin.length !== 6) {
        if (!cancelled) setCheck(null);
        return;
      }
      try {
        const response = await fetch(`/api/v1/shipping/pincode/${pin}`);
        if (!response.ok) return;
        const body = (await response.json()) as { data?: PincodeCheck };
        if (cancelled) return;
        setCheck(body.data ?? null);
        // Fill the city/state the operator would otherwise have to look up.
        setShipping((current) =>
          current.pinCode.trim() === pin && body.data
            ? { ...current, city: current.city || (body.data.city ?? ""), state: current.state || (body.data.state ?? "") }
            : current,
        );
      } catch {
        // A serviceability lookup failure must never block keying an order.
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pin]);

  // ---- live re-pricing -----------------------------------------------------
  const priceable = lines.filter((line) => line.info && !line.info.problem && line.variantId);
  const previewKey = JSON.stringify({
    items: priceable.map((line) => ({
      productId: line.info?.id,
      variantId: line.variantId,
      quantity: line.quantity,
      customization: line.answers,
      unitPriceOverridePaise: paymentMethod === "MANUAL" ? line.overridePaise : null,
      overrideReason: line.overrideReason || undefined,
    })),
    couponCode: couponCode.trim() || undefined,
    shippingRateId: shippingRateId ?? undefined,
    paymentMethod,
    pinCode: pin.length === 6 ? pin : undefined,
    state: shipping.state || undefined,
    customerEmail: customer ? undefined : newCustomer.email || undefined,
    customerId: customer?.id ?? undefined,
  });
  const debouncedKey = useDebouncedValue(previewKey, 500);

  React.useEffect(() => {
    let cancelled = false;
    const payload = JSON.parse(debouncedKey) as Parameters<typeof previewOrderDraftAction>[0];
    const empty = !payload.items || payload.items.length === 0;

    // Deferred to a microtask so no state is written while the effect body is
    // still running; the cancelled flag drops the answer to a stale basket.
    const run = async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (empty) {
        setDraft(null);
        return;
      }
      setPricing(true);
      try {
        const result = await previewOrderDraftAction(payload);
        if (!cancelled) setDraft(result.ok ? (result.data as OrderDraft | null) : null);
      } finally {
        if (!cancelled) setPricing(false);
      }
    };
    void run();

    return () => {
      cancelled = true;
    };
  }, [debouncedKey]);

  const rates = draft?.shipping.quote?.rates ?? [];

  // ---- submit --------------------------------------------------------------
  const submit = async () => {
    const payload: ManualOrderInput = {
      customerId: customer?.id ?? null,
      customer: customer ? undefined : { email: newCustomer.email, name: newCustomer.name || undefined, phone: newCustomer.phone || undefined },
      shippingAddress: { ...shipping, email: shipping.email || undefined },
      billingSameAsShipping: billingSame,
      billingAddress: billingSame ? undefined : { ...billing, email: billing.email || undefined },
      items: priceable.map((line) => ({
        productId: line.info?.id ?? "",
        variantId: line.variantId,
        quantity: line.quantity,
        customization: Object.keys(line.answers).length > 0 ? line.answers : undefined,
        unitPriceOverridePaise: paymentMethod === "MANUAL" ? line.overridePaise : null,
        overrideReason: line.overrideReason || undefined,
      })),
      couponCode: couponCode.trim() || undefined,
      shippingRateId: shippingRateId ?? undefined,
      paymentMethod,
      customerNote: customerNote || undefined,
      internalNote: internalNote || undefined,
    };
    const result = await run(() => createManualOrderAction(payload));
    if (result.ok && result.data) router.push(`/admin/orders/${result.data.orderId}` as Route);
  };

  const canSubmit = priceable.length > 0 && shipping.line1.length > 2 && pin.length === 6 && (customer !== null || newCustomer.email.includes("@"));

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-4">
        <FormSection title="Customer" description="Pick an existing customer, or key a new one — the email is what links the order to their history.">
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Existing customer</Label>
              <EntityPicker kind="customer" value={customer} onChange={setCustomer} placeholder="Search by name or email…" />
            </div>
            {customer ? null : (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="new-email" className="text-xs">
                    Email
                  </Label>
                  <Input id="new-email" type="email" value={newCustomer.email} onChange={(event) => setNewCustomer((c) => ({ ...c, email: event.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="new-name" className="text-xs">
                    Name
                  </Label>
                  <Input id="new-name" value={newCustomer.name} onChange={(event) => setNewCustomer((c) => ({ ...c, name: event.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="new-phone" className="text-xs">
                    Phone
                  </Label>
                  <Input id="new-phone" value={newCustomer.phone} onChange={(event) => setNewCustomer((c) => ({ ...c, phone: event.target.value }))} inputMode="tel" />
                </div>
              </div>
            )}
          </div>
        </FormSection>

        <FormSection title="Shipping address" description="The PIN code is checked against the shipping zones as you type.">
          <AddressFields legend="Shipping" values={shipping} onChange={(patch) => setShipping((current) => ({ ...current, ...patch }))} check={check} />
        </FormSection>

        <FormSection
          title="Billing address"
          actions={
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={billingSame} onCheckedChange={setBillingSame} aria-label="Billing same as shipping" />
              Same as shipping
            </label>
          }
        >
          {billingSame ? (
            <p className="text-muted-foreground text-xs">The shipping address is copied onto the invoice.</p>
          ) : (
            <AddressFields legend="Billing" values={billing} onChange={(patch) => setBilling((current) => ({ ...current, ...patch }))} />
          )}
        </FormSection>

        <FormSection title="Items" description="Variants, quantities and any personalisation the customer asked for.">
          <ManualOrderItems lines={lines} allowOverride={paymentMethod === "MANUAL"} onChange={setLines} onPickProduct={(key, ref) => void pickProduct(key, ref)} />
        </FormSection>

        <FormSection title="Notes">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="customer-note" className="text-xs">
                Customer note
              </Label>
              <Textarea id="customer-note" rows={3} value={customerNote} onChange={(event) => setCustomerNote(event.target.value)} placeholder="Delivery instructions the customer gave…" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="internal-note" className="text-xs">
                Internal note
              </Label>
              <Textarea id="internal-note" rows={3} value={internalNote} onChange={(event) => setInternalNote(event.target.value)} placeholder="Only the team sees this." />
            </div>
          </div>
        </FormSection>
      </div>

      <div className="min-w-0 space-y-4">
        <FormSection title="Payment">
          <div className="grid gap-3">
            <SearchableSelect
              options={PAYMENT_METHODS.map((method) => ({
                value: method,
                label: PAYMENT_METHOD_META[method].label,
                description: PAYMENT_METHOD_META[method].description,
              }))}
              value={paymentMethod}
              onChange={(next) => setPaymentMethod((next as PaymentMethod) ?? "COD")}
              searchable={false}
            />
            <p className="text-muted-foreground text-[11px]">
              {paymentMethod === "ONLINE"
                ? "The order starts pending with stock reserved; a payment link is opened for the customer."
                : "The order is confirmed on entry and stock is sold immediately."}
            </p>
          </div>
        </FormSection>

        <FormSection title="Coupon">
          <div className="grid gap-1.5">
            <Label htmlFor="coupon" className="text-xs">
              Code
            </Label>
            <Input id="coupon" value={couponCode} onChange={(event) => setCouponCode(event.target.value.toUpperCase())} placeholder="WELCOME10" />
            {draft?.coupon ? (
              <p className="text-success flex items-center gap-1 text-[11px]">
                <Tag className="size-3" /> {draft.coupon.code} applied — {draft.coupon.freeShipping ? "free shipping" : formatPaise(draft.coupon.discountPaise)}
              </p>
            ) : null}
            {draft?.couponRejection ? <p className="text-destructive text-[11px]">{draft.couponRejection.message}</p> : null}
          </div>
        </FormSection>

        <FormSection title="Shipping method">
          {rates.length === 0 ? (
            <p className="text-muted-foreground text-xs">Enter a serviceable PIN code and at least one item to see rates.</p>
          ) : (
            <div className="grid gap-2">
              {rates.map((rate) => (
                <label key={rate.rateId} className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs">
                  <input
                    type="radio"
                    name="shipping-rate"
                    className="mt-0.5"
                    checked={(shippingRateId ?? draft?.shipping.rateId) === rate.rateId}
                    onChange={() => setShippingRateId(rate.rateId)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2 font-medium">
                      <span className="flex items-center gap-1">
                        <Truck className="size-3" /> {rate.name}
                      </span>
                      <span data-numeric>{rate.isFree ? "Free" : formatPaise(rate.ratePaise)}</span>
                    </span>
                    <span className="text-muted-foreground block">
                      {rate.estimatedDaysMin}–{rate.estimatedDaysMax} days{rate.codAvailable ? " · COD available" : " · prepaid only"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </FormSection>

        <section className="surface overflow-hidden">
          <header className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
            <h2 className="text-xs font-semibold tracking-tight">Totals</h2>
            {pricing ? <Loader2 className="text-muted-foreground size-3.5 animate-spin" /> : null}
          </header>
          <div className="space-y-1.5 p-4 text-xs">
            {draft ? (
              <>
                <Total label="Subtotal" value={formatPaise(draft.totals.subtotalPaise)} />
                {draft.totals.discountPaise > 0 ? <Total label="Promotion discount" value={`−${formatPaise(draft.totals.discountPaise)}`} /> : null}
                {draft.totals.couponDiscountPaise > 0 ? <Total label="Coupon" value={`−${formatPaise(draft.totals.couponDiscountPaise)}`} /> : null}
                <Total label="Shipping" value={formatPaise(draft.totals.shippingPaise)} />
                {draft.totals.codFeePaise > 0 ? <Total label="COD fee" value={formatPaise(draft.totals.codFeePaise)} /> : null}
                <Total label={draft.pricesIncludeTax ? "Tax (included)" : "Tax"} value={formatPaise(draft.totals.taxPaise)} />
                <Total label="Total" value={formatPaise(draft.totals.totalPaise)} strong />
                {draft.warnings.map((warning) => (
                  <p key={warning.code} className="text-warning text-[11px]">
                    {warning.message}
                  </p>
                ))}
              </>
            ) : (
              <p className="text-muted-foreground">Add an item to price the order.</p>
            )}
          </div>
        </section>

        <FormActions
          dirty={priceable.length > 0}
          pending={pending}
          disabled={!canSubmit}
          submitLabel="Create order"
          onSubmit={() => void submit()}
          onCancel={() => router.push("/admin/orders" as Route)}
          warnOnLeave={false}
        />
      </div>
    </div>
  );
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "border-t pt-1.5 text-sm font-semibold" : ""}`}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span data-numeric>{value}</span>
    </div>
  );
}
