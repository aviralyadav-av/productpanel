"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormRow, FormRowGroup, FormSection } from "@/components/shared/form-layout";
import { MoneyInput } from "@/components/shared/money-input";
import { PercentInput } from "@/components/shared/percent-input";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";
import { COMMISSION_SCOPE_META } from "@/lib/enums";
import { formatPaise, formatPercent } from "@/lib/money";

import { removeCategoryCommissionAction, saveCategoryCommissionAction } from "../actions";
import type { EffectiveCommission } from "../queries";
import type { CategoryCommissionRule } from "../service";

/**
 * Commission override for one category (blueprint B3): a `CommissionRule`
 * with targetKey `CATEGORY:<id>`. The effective rule is shown first because
 * the override only matters relative to what would apply without it - the
 * nearest ancestor's rule, or the global default. Seller and product rules
 * still beat this one (B3 precedence), which the hint spells out.
 */
export function CommissionSection({
  categoryId,
  own,
  effective,
  canManage,
}: {
  categoryId: string;
  own: CategoryCommissionRule | null;
  effective: EffectiveCommission;
  canManage: boolean;
}) {
  const { pending, run } = useActionToast();
  const [rateBps, setRateBps] = React.useState<number | null>(own?.rateBps ?? null);
  const [fixedPaise, setFixedPaise] = React.useState<number | null>(own?.fixedPaise ?? 0);
  const [note, setNote] = React.useState(own?.note ?? "");
  const [error, setError] = React.useState<string | null>(null);

  const scopeMeta = COMMISSION_SCOPE_META[effective.scope];
  const dirty = rateBps !== (own?.rateBps ?? null) || (fixedPaise ?? 0) !== (own?.fixedPaise ?? 0) || note !== (own?.note ?? "");

  async function save() {
    if (rateBps === null) {
      setError("Enter a commission rate.");
      return;
    }
    setError(null);
    const result = await run(() =>
      saveCategoryCommissionAction({ categoryId, rateBps, fixedPaise: fixedPaise ?? 0, note: note || null }),
    );
    if (!result.ok && result.fieldErrors) setError(Object.values(result.fieldErrors)[0] ?? result.error);
  }

  async function remove() {
    await run(() => removeCategoryCommissionAction(categoryId), {
      onSuccess: () => {
        setRateBps(null);
        setFixedPaise(0);
        setNote("");
      },
    });
  }

  return (
    <FormSection
      title="Commission"
      description="Override the platform commission for products in this category. Seller-specific and product-specific rules still take precedence."
      actions={
        <Button asChild variant="ghost" size="xs">
          <Link href={"/admin/commissions" as Route}>All rules</Link>
        </Button>
      }
    >
      <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2">
        <div className="space-y-0.5">
          <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">Effective rate</p>
          <p className="text-sm font-semibold" data-numeric>
            {formatPercent(effective.rateBps / 100, 2)}
            {effective.fixedPaise > 0 ? <span className="text-muted-foreground font-normal"> + {formatPaise(effective.fixedPaise)} per item</span> : null}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <StatusPill label={scopeMeta.label} tone={scopeMeta.tone} dot={false} />
          {effective.sourceCategory && effective.sourceCategory.id !== categoryId ? (
            <Link href={`/admin/categories/${effective.sourceCategory.id}` as Route} className="hover:underline">
              {effective.sourceLabel}
            </Link>
          ) : (
            <span className="text-muted-foreground">{effective.sourceLabel}</span>
          )}
        </div>
      </div>

      <FormRowGroup columns={3}>
        <FormRow label="Override rate" htmlFor="commission-rate" error={error ?? undefined} hint="Percent of the taxable line value.">
          <PercentInput id="commission-rate" valueBps={rateBps} onChangeBps={setRateBps} disabled={!canManage || pending} invalid={Boolean(error)} />
        </FormRow>
        <FormRow label="Fixed per item" htmlFor="commission-fixed" hint="Optional flat amount on top of the rate.">
          <MoneyInput id="commission-fixed" valuePaise={fixedPaise} onChangePaise={setFixedPaise} disabled={!canManage || pending} allowEmpty />
        </FormRow>
        <FormRow label="Note" htmlFor="commission-note" hint="Why this category differs; shown to finance.">
          <Input id="commission-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} disabled={!canManage || pending} />
        </FormRow>
      </FormRowGroup>

      {canManage ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-[11px]">
            {own ? `Override active since ${new Date(own.updatedAt).toLocaleDateString("en-IN")}.` : "No override: the inherited rate applies."}
          </p>
          <div className="flex items-center gap-2">
            {own ? (
              <Button type="button" variant="outline" size="sm" disabled={pending} onClick={remove}>
                <Trash2 /> Remove override
              </Button>
            ) : null}
            <Button type="button" size="sm" disabled={pending || !dirty || rateBps === null} onClick={save}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              {own ? "Update override" : "Set override"}
            </Button>
          </div>
        </div>
      ) : null}
    </FormSection>
  );
}
