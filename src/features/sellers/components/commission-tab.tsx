"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Percent } from "lucide-react";

import { COMMISSION_SCOPE_META } from "@/lib/enums";
import { formatIstDateTime } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { FormRow, FormRowGroup, FormSection } from "@/components/shared/form-layout";
import { MoneyInput } from "@/components/shared/money-input";
import { PercentInput } from "@/components/shared/percent-input";
import { PermissionGate } from "@/components/shared/permission-gate";
import { StatCard } from "@/components/shared/stat-card";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";

import { deleteCommissionOverrideAction, upsertCommissionOverrideAction } from "@/features/sellers/actions";
import type { SellerCommissionInfo } from "@/features/sellers/types";

/**
 * Commission tab (B3). Shows what an order line for this seller would snapshot
 * today and where that number comes from, then the SELLER:<id> override
 * editor. Product- and category-scope rules still beat/lose per B3 and live
 * on /admin/commissions.
 */
export function CommissionTab({ sellerId, info }: { sellerId: string; info: SellerCommissionInfo }) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const [rateBps, setRateBps] = React.useState<number | null>(info.override?.rateBps ?? info.resolved.rateBps);
  const [fixedPaise, setFixedPaise] = React.useState<number | null>(info.override?.fixedPaise ?? 0);
  const [note, setNote] = React.useState(info.override?.note ?? "");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    const result = await run(
      () => upsertCommissionOverrideAction(sellerId, { rateBps: rateBps ?? 0, fixedPaise: fixedPaise ?? 0, note }),
      { onSuccess: () => router.refresh() },
    );
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  async function remove() {
    const result = await confirm({
      title: "Remove the commission override?",
      description: "New order lines for this seller will snapshot the category or marketplace rate instead. Existing orders keep their snapshot.",
      confirmLabel: "Remove override",
      destructive: true,
    });
    if (!result.ok) return;
    await run(() => deleteCommissionOverrideAction(sellerId), { onSuccess: () => router.refresh() });
  }

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Effective rate"
          value={pct(info.resolved.rateBps)}
          hint={
            info.resolved.fixedPaise > 0
              ? `+ ${formatPaise(info.resolved.fixedPaise)} per unit`
              : `Source: ${COMMISSION_SCOPE_META[info.resolved.scope].label.toLowerCase()} rule`
          }
        />
        <StatCard
          label="Marketplace default"
          value={info.global ? pct(info.global.rateBps) : "—"}
          hint={info.global?.fixedPaise ? `+ ${formatPaise(info.global.fixedPaise)} per unit` : "GLOBAL rule"}
        />
        <div className="surface p-4">
          <span className="text-muted-foreground text-xs font-medium">Resolution order</span>
          <p className="mt-2 text-xs leading-relaxed">
            Product → <strong>Seller</strong> → nearest category → global. A seller rate is a negotiated contract, so it beats category defaults.
          </p>
          <Link href="/admin/commissions" className="text-brand mt-2 inline-block text-xs hover:underline">
            All commission rules
          </Link>
        </div>
      </section>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Override:</span>
        {info.override ? (
          <>
            <StatusPill label={info.override.isActive ? "Active" : "Inactive"} tone={info.override.isActive ? "success" : "neutral"} />
            <span className="text-muted-foreground">updated {formatIstDateTime(new Date(info.override.updatedAt))}</span>
          </>
        ) : (
          <StatusPill label="Inherits" tone="neutral" dot={false} />
        )}
      </div>

      <PermissionGate
        require="commissions.manage"
        fallback={<p className="text-muted-foreground text-xs">Changing the override requires the commissions.manage permission.</p>}
      >
        <form onSubmit={save}>
          <FormSection
            title="Seller override"
            description="Applies to every product this seller lists unless a product-level rule exists. Fixed amount is per unit sold."
            actions={
              info.override ? (
                <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={pending} onClick={() => void remove()}>
                  Remove override
                </Button>
              ) : undefined
            }
          >
            <FormRowGroup columns={3}>
              <FormRow label="Rate" htmlFor="override-rate" required error={errors.rateBps}>
                <PercentInput id="override-rate" valueBps={rateBps} onChangeBps={setRateBps} disabled={pending} required />
              </FormRow>
              <FormRow label="Fixed per unit" htmlFor="override-fixed" error={errors.fixedPaise}>
                <MoneyInput id="override-fixed" valuePaise={fixedPaise} onChangePaise={setFixedPaise} disabled={pending} allowEmpty={false} />
              </FormRow>
              <FormRow label="Note" htmlFor="override-note" error={errors.note} hint="Why this seller has its own rate.">
                <Input id="override-note" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} disabled={pending} />
              </FormRow>
            </FormRowGroup>
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={pending}>
                <Percent />
                {info.override ? "Update override" : "Set override"}
              </Button>
            </div>
          </FormSection>
        </form>
      </PermissionGate>
      {confirmDialog}
    </div>
  );
}
