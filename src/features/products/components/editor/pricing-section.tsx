"use client";

import { FormRow, FormRowGroup, FormSection } from "@/components/shared/form-layout";
import { MoneyInput } from "@/components/shared/money-input";
import { PercentInput } from "@/components/shared/percent-input";
import { Input } from "@/components/ui/input";
import { formatPaise, formatPercent } from "@/lib/money";

import type { SectionProps } from "./basics-section";
import { marginPercent } from "./form-state";

export function PricingSection({ state, set, errors, disabled, defaultTaxBps }: SectionProps & { defaultTaxBps: number }) {
  const margin = marginPercent(state.salePricePaise ?? state.pricePaise, state.costPaise);
  const discount = state.pricePaise && state.salePricePaise && state.salePricePaise < state.pricePaise ? Math.round(((state.pricePaise - state.salePricePaise) / state.pricePaise) * 100) : null;

  return (
    <FormSection id="pricing" title="Pricing" description="Prices are stored in paise and shown in rupees. A sale price must be lower than the price; the lowest of sale price and any active promotion is charged, never both (blueprint 11.6).">
      <FormRowGroup columns={2}>
        <FormRow label="Price" htmlFor="pricePaise" required error={errors.pricePaise}>
          <MoneyInput id="pricePaise" valuePaise={state.pricePaise} onChangePaise={(pricePaise) => set({ pricePaise })} disabled={disabled} invalid={!!errors.pricePaise} allowEmpty />
        </FormRow>
        <FormRow label="Sale price" htmlFor="salePricePaise" error={errors.salePricePaise} hint={discount !== null ? `${discount}% off` : "Optional."}>
          <MoneyInput id="salePricePaise" valuePaise={state.salePricePaise} onChangePaise={(salePricePaise) => set({ salePricePaise })} disabled={disabled} invalid={!!errors.salePricePaise} allowEmpty />
        </FormRow>
      </FormRowGroup>
      <FormRowGroup columns={2}>
        <FormRow label="Sale starts" htmlFor="saleStartsAt" error={errors.saleStartsAt} hint="Blank = immediately.">
          <Input id="saleStartsAt" type="datetime-local" value={state.saleStartsAt} onChange={(event) => set({ saleStartsAt: event.target.value })} disabled={disabled} />
        </FormRow>
        <FormRow label="Sale ends" htmlFor="saleEndsAt" error={errors.saleEndsAt} hint="Blank = until removed.">
          <Input id="saleEndsAt" type="datetime-local" value={state.saleEndsAt} onChange={(event) => set({ saleEndsAt: event.target.value })} disabled={disabled} />
        </FormRow>
      </FormRowGroup>
      <FormRowGroup columns={2}>
        <FormRow label="Cost price" htmlFor="costPaise" error={errors.costPaise} hint={margin !== null ? `Margin ${formatPercent(margin)} on ${formatPaise(state.salePricePaise ?? state.pricePaise)}` : "Never shown publicly; used for margin."}>
          <MoneyInput id="costPaise" valuePaise={state.costPaise} onChangePaise={(costPaise) => set({ costPaise })} disabled={disabled} allowEmpty />
        </FormRow>
        <FormRow label="Tax rate" htmlFor="taxRateBps" error={errors.taxRateBps} hint={`Blank = store default (${formatPercent(defaultTaxBps / 100, 2)}).`}>
          <PercentInput id="taxRateBps" valueBps={state.taxRateBps} onChangeBps={(taxRateBps) => set({ taxRateBps })} disabled={disabled} placeholder="Default" />
        </FormRow>
      </FormRowGroup>
      <FormRow label="HSN code" htmlFor="hsnCode" error={errors.hsnCode} hint="For GST invoices and the tax report.">
        <Input id="hsnCode" value={state.hsnCode} onChange={(event) => set({ hsnCode: event.target.value })} maxLength={16} className="w-40" disabled={disabled} />
      </FormRow>
    </FormSection>
  );
}
