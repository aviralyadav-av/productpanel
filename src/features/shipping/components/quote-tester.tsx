"use client";

import * as React from "react";
import { Calculator } from "lucide-react";

import { quotePreviewAction } from "@/features/shipping/actions";
import type { ShippingQuote } from "@/features/shipping/service";
import { EntityPicker, type EntityRef } from "@/components/shared/entity-picker";
import { FormRow, FormRowGroup } from "@/components/shared/form-layout";
import { NumberStepper } from "@/components/shared/number-stepper";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SHIPPING_METHOD_META, type ShippingMethod } from "@/lib/enums";
import { formatIstDate } from "@/lib/dates";
import { formatPaise } from "@/lib/money";

type Payment = "ONLINE" | "COD";

/**
 * "What would a shopper in 560001 pay for this basket?" - runs the same
 * `quoteShipping` the storefront and checkout use, so an operator can check a
 * new rate or zone before a customer finds the gap.
 */
export function QuoteTester({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { pending, run } = useActionToast();
  const [pinCode, setPinCode] = React.useState("");
  const [products, setProducts] = React.useState<EntityRef[]>([]);
  const [quantity, setQuantity] = React.useState(1);
  const [payment, setPayment] = React.useState<Payment>("ONLINE");
  const [result, setResult] = React.useState<(ShippingQuote & { subtotalPaise: number; missing: string[] }) | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const canRun = /^[1-9]\d{5}$/.test(pinCode) && products.length > 0 && !pending;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canRun) return;
    setError(null);
    const outcome = await run(
      () => quotePreviewAction({ pinCode, items: products.map((product) => ({ productId: product.id, quantity })), paymentMethod: payment }),
      { silent: true, onSuccess: (data) => setResult(data), onError: (failure) => setError(failure.error) },
    );
    if (!outcome.ok) setResult(null);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Test a shipping quote</DialogTitle>
          <DialogDescription>Runs the exact rate selection checkout uses: zone resolution, weight and order bounds, free-above and COD rules.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormRowGroup columns={3}>
            <FormRow label="Pincode" htmlFor="quote-pin" required>
              <Input id="quote-pin" inputMode="numeric" maxLength={6} value={pinCode} onChange={(event) => setPinCode(event.target.value.replace(/\D/g, ""))} placeholder="560001" />
            </FormRow>
            <FormRow label="Quantity each" htmlFor="quote-qty">
              <NumberStepper id="quote-qty" value={quantity} onChange={setQuantity} min={1} max={100} aria-label="Quantity per product" />
            </FormRow>
            <FormRow label="Payment" htmlFor="quote-payment">
              <Select value={payment} onValueChange={(value) => setPayment(value as Payment)}>
                <SelectTrigger id="quote-payment" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ONLINE">Online</SelectItem>
                  <SelectItem value="COD">Cash on delivery</SelectItem>
                </SelectContent>
              </Select>
            </FormRow>
          </FormRowGroup>

          <FormRow label="Products" htmlFor="quote-products" required hint="Weights come from the product (500 g when unset); prices are the current effective prices.">
            <EntityPicker id="quote-products" kind="product" multiple value={products} onChange={setProducts} placeholder="Search products" limit={20} />
          </FormRow>

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!canRun}>
              <Calculator /> Get quote
            </Button>
          </div>
        </form>

        {error ? <p className="text-destructive text-xs">{error}</p> : null}

        {result ? (
          <div className="space-y-3 border-t pt-3 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <StatusPill label={result.serviceable ? "Serviceable" : "Not serviceable"} tone={result.serviceable ? "success" : "danger"} />
              <span className="text-muted-foreground">
                Zone: <span className="text-foreground">{result.zone?.name ?? "none"}</span>
                {result.pincode.matchedBy ? ` (by ${result.pincode.matchedBy})` : ""}
              </span>
              <span className="text-muted-foreground" data-numeric>Weight: {result.weightGrams} g</span>
              <span className="text-muted-foreground" data-numeric>Subtotal: {formatPaise(result.subtotalPaise)}</span>
              {result.pincode.city ? <span className="text-muted-foreground">{result.pincode.city}, {result.pincode.state}</span> : null}
            </div>

            {result.rates.length === 0 ? (
              <p className="text-muted-foreground text-xs">No rate matched. Reasons: {result.reasons.join(", ") || "none recorded"}.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {result.rates.map((rate) => (
                  <li key={rate.rateId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{rate.name}</span>
                        <StatusPill label={SHIPPING_METHOD_META[rate.method as ShippingMethod]?.label ?? rate.method} tone={SHIPPING_METHOD_META[rate.method as ShippingMethod]?.tone ?? "neutral"} dot={false} />
                        {rate.rateId === result.defaultRateId ? <StatusPill label="Default" tone="brand" dot={false} /> : null}
                      </div>
                      <p className="text-muted-foreground text-xs" data-numeric>
                        {rate.estimatedDaysMin}–{rate.estimatedDaysMax} days · by {formatIstDate(rate.estimatedDeliveryAt)}
                        {rate.codAvailable ? ` · COD fee ${formatPaise(rate.codFeePaise)}` : " · no COD"}
                      </p>
                    </div>
                    <div className="text-right" data-numeric>
                      <span className="font-medium">{rate.isFree ? "Free" : formatPaise(rate.ratePaise)}</span>
                      {rate.isFree && rate.baseRatePaise > 0 ? <span className="text-muted-foreground ml-1 text-xs line-through">{formatPaise(rate.baseRatePaise)}</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {result.reasons.length > 0 && result.rates.length > 0 ? (
              <p className="text-muted-foreground text-[11px]">Excluded: {result.reasons.join(", ")}</p>
            ) : null}
            {result.missing.length > 0 ? <p className="text-warning text-[11px]">Not found in the catalogue: {result.missing.join(", ")}</p> : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
