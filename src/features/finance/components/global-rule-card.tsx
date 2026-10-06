"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Globe, Pencil } from "lucide-react";

import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormRow } from "@/components/shared/form-layout";
import { MoneyInput } from "@/components/shared/money-input";
import { PercentInput } from "@/components/shared/percent-input";
import { useActionToast } from "@/components/shared/use-action-toast";

import { saveGlobalRuleAction } from "../actions";
import type { CommissionRuleRow } from "../queries";
import { formatBps } from "../ui-identity";

/**
 * The single GLOBAL commission rule, edited in place (blueprint §14.B3).
 *
 * It gets its own card rather than being just another table row because it is
 * the number that applies to every sale no other rule covers - the one an
 * operator changes most often and the one every other rate is read against.
 * When the row is missing entirely, the card says so and offers to create it:
 * `resolveCommission` silently falls back to 0% without it, which would
 * quietly stop the platform earning anything.
 */
export function GlobalRuleCard({
  rule,
  canManage,
}: {
  rule: CommissionRuleRow | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [editing, setEditing] = React.useState(false);
  const [rateBps, setRateBps] = React.useState<number | null>(rule?.rateBps ?? 0);
  const [fixedPaise, setFixedPaise] = React.useState<number | null>(rule?.fixedPaise ?? 0);
  const [note, setNote] = React.useState(rule?.note ?? "");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  function startEditing() {
    setRateBps(rule?.rateBps ?? 0);
    setFixedPaise(rule?.fixedPaise ?? 0);
    setNote(rule?.note ?? "");
    setErrors({});
    setEditing(true);
  }

  async function save() {
    const result = await run(
      () =>
        saveGlobalRuleAction({
          rateBps: rateBps ?? 0,
          fixedPaise: fixedPaise ?? 0,
          note: note.trim() || null,
        }),
      {
        onSuccess: () => {
          setEditing(false);
          router.refresh();
        },
      },
    );
    if (!result.ok) setErrors(result.fieldErrors ?? {});
  }

  return (
    <section className="surface space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="bg-brand-muted text-brand grid size-8 shrink-0 place-items-center rounded-md">
            <Globe className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Global commission</h2>
            <p className="text-muted-foreground text-xs">
              The fallback for every sale no category, seller or product rule covers.
            </p>
          </div>
        </div>
        {canManage && !editing ? (
          <Button variant="outline" size="sm" onClick={startEditing}>
            <Pencil />
            Edit
          </Button>
        ) : null}
      </div>

      {editing ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormRow label="Rate" htmlFor="global-rate" error={errors.rateBps} hint="Of the taxable value.">
              <PercentInput
                id="global-rate"
                valueBps={rateBps}
                onChangeBps={setRateBps}
                invalid={Boolean(errors.rateBps)}
              />
            </FormRow>
            <FormRow label="Fixed per unit" htmlFor="global-fixed" error={errors.fixedPaise}>
              <MoneyInput
                id="global-fixed"
                valuePaise={fixedPaise}
                onChangePaise={setFixedPaise}
                invalid={Boolean(errors.fixedPaise)}
              />
            </FormRow>
          </div>
          <FormRow label="Note" htmlFor="global-note" error={errors.note}>
            <Textarea
              id="global-note"
              rows={2}
              maxLength={300}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Standard marketplace rate"
            />
          </FormRow>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={pending}>
              Save
            </Button>
          </div>
        </div>
      ) : rule ? (
        <div className="grid grid-cols-2 gap-3">
          <Figure label="Rate" value={formatBps(rule.rateBps)} />
          <Figure label="Fixed per unit" value={rule.fixedPaise > 0 ? formatPaise(rule.fixedPaise) : "—"} />
          {rule.note ? (
            <p className="text-muted-foreground col-span-2 text-xs">{rule.note}</p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-warning text-xs">
            No global rule exists. Until one does, any sale not covered by a more specific rule earns the
            platform nothing.
          </p>
          {canManage ? (
            <Button size="sm" onClick={startEditing}>
              Set the global rate
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-[11px] uppercase tracking-wide">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
