"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDown, Check, FlaskConical } from "lucide-react";
import { cn } from "cn";

import { COMMISSION_SCOPE_META } from "@/lib/enums";
import { formatPaise } from "@/lib/money";
import { EntityPicker, type EntityRef } from "@/components/shared/entity-picker";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";

import { resolveCommissionAction } from "../actions";
import type { CommissionResolution } from "../queries";
import { formatBps } from "../ui-identity";

/**
 * "Resolve for a product" tester (blueprint §14.B3).
 *
 * Answers the question the rules table cannot: given all these rules, what
 * rate does THIS product actually get, and why? Showing the whole chain -
 * including the rules that exist but lost - is the point; a single resolved
 * number would leave the operator guessing which rule they need to edit.
 */
export function CommissionResolverCard({
  initialProduct,
  /**
   * Resolved on the server when the page arrives with `?product=<id>`, so a
   * bookmarked "why is this 12%?" link opens already answered instead of
   * flashing an empty card while an effect fetches.
   */
  initialResolution,
}: {
  initialProduct: EntityRef | null;
  initialResolution: CommissionResolution | null;
}) {
  const { pending, run } = useActionToast();
  const [product, setProduct] = React.useState<EntityRef | null>(initialProduct);
  const [resolution, setResolution] = React.useState<CommissionResolution | null>(initialResolution);

  const resolve = React.useCallback(
    async (ref: EntityRef | null) => {
      setProduct(ref);
      if (!ref) {
        setResolution(null);
        return;
      }
      await run(() => resolveCommissionAction(ref.id), {
        silent: true,
        onSuccess: setResolution,
        onError: () => setResolution(null),
      });
    },
    [run],
  );

  return (
    <section className="surface space-y-3 p-4">
      <div className="flex items-start gap-2.5">
        <span className="bg-info-muted text-info grid size-8 shrink-0 place-items-center rounded-md">
          <FlaskConical className="size-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold">Resolve for a product</h2>
          <p className="text-muted-foreground text-xs">
            Product → seller → nearest category ancestor → global. The first active rule inside its window wins.
          </p>
        </div>
      </div>

      <EntityPicker
        kind="product"
        value={product}
        onChange={(value) => void resolve(value)}
        placeholder="Search a product…"
      />

      {pending ? <p className="text-muted-foreground text-xs">Resolving…</p> : null}

      {resolution ? (
        <div className="space-y-3">
          <div className="bg-muted/40 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md p-3">
            <div>
              <p className="text-muted-foreground text-[11px] uppercase tracking-wide">Resolved rate</p>
              <p className="text-lg font-semibold tabular-nums">{formatBps(resolution.resolved.rateBps)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-[11px] uppercase tracking-wide">Fixed / unit</p>
              <p className="text-lg font-semibold tabular-nums">
                {resolution.resolved.fixedPaise > 0 ? formatPaise(resolution.resolved.fixedPaise) : "—"}
              </p>
            </div>
            <div className="ml-auto">
              <StatusPill
                label={`${COMMISSION_SCOPE_META[resolution.resolved.scope].label} rule`}
                tone={COMMISSION_SCOPE_META[resolution.resolved.scope].tone}
              />
              {resolution.resolved.ruleId === null ? (
                <p className="text-warning mt-1 text-[11px]">
                  No rule matched - commission falls back to zero.
                </p>
              ) : null}
            </div>
          </div>

          <p className="text-muted-foreground text-xs">
            {resolution.seller ? (
              <>
                Sold by{" "}
                <Link href={resolution.seller.href} className="underline">
                  {resolution.seller.name}
                </Link>
              </>
            ) : (
              "Platform-owned product"
            )}
            {resolution.category ? ` · ${resolution.category.name}` : null}
          </p>

          <ol className="space-y-1.5">
            {resolution.chain.map((step, index) => (
              <li key={`${step.targetKey}-${index}`} className="flex items-start gap-2">
                <span className="pt-1.5">
                  {step.applied ? (
                    <Check className="text-success size-3.5" />
                  ) : (
                    <ArrowDown className="text-muted-foreground/50 size-3.5" />
                  )}
                </span>
                <div
                  className={cn(
                    "min-w-0 flex-1 rounded-md border px-2.5 py-1.5",
                    step.applied ? "border-success/40 bg-success-muted/40" : "border-dashed",
                  )}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-xs font-medium">
                      <span className="text-muted-foreground mr-1.5 text-[10px] uppercase tracking-wide">
                        {COMMISSION_SCOPE_META[step.scope].label}
                      </span>
                      {step.label}
                    </span>
                    <span className="text-xs tabular-nums">
                      {step.rule ? (
                        <>
                          {formatBps(step.rule.rateBps)}
                          {step.rule.fixedPaise > 0 ? ` + ${formatPaise(step.rule.fixedPaise)}/unit` : ""}
                        </>
                      ) : (
                        <span className="text-muted-foreground/70">no rule</span>
                      )}
                    </span>
                  </div>
                  {step.skippedReason ? (
                    <p className="text-muted-foreground text-[11px]">{step.skippedReason}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : product && !pending ? (
        <p className="text-muted-foreground text-xs">No resolution available for that product.</p>
      ) : null}
    </section>
  );
}
