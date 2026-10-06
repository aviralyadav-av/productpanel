"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EntityPicker, type EntityRef } from "@/components/shared/entity-picker";
import { FieldError, FormRow } from "@/components/shared/form-layout";
import { MoneyInput } from "@/components/shared/money-input";
import { PercentInput } from "@/components/shared/percent-input";
import { useActionToast } from "@/components/shared/use-action-toast";
import { COMMISSION_SCOPES, COMMISSION_SCOPE_META, type CommissionScope } from "@/lib/enums";

import { createCommissionRuleAction, updateCommissionRuleAction } from "../actions";
import type { CommissionRuleRow } from "../queries";

/**
 * New / edit dialog for a commission rule (blueprint §14.B3).
 *
 * The scope picker drives which EntityPicker appears, and `targetKey` is
 * derived server-side from `scope + targetId` - the form never sends a key, so
 * a hand-edited request cannot invent one. A duplicate target comes back as a
 * 409 with a sentence on the field rather than a Prisma constraint error.
 */

const SCOPE_KIND: Record<Exclude<CommissionScope, "GLOBAL">, "category" | "seller" | "product"> = {
  CATEGORY: "category",
  SELLER: "seller",
  PRODUCT: "product",
};

/** `Date | null` → the value an `<input type="datetime-local">` wants. */
function toLocalInput(value: Date | string | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

type FormState = {
  scope: CommissionScope;
  target: EntityRef | null;
  rateBps: number | null;
  fixedPaise: number | null;
  startsAt: string;
  endsAt: string;
  note: string;
  isActive: boolean;
};

function initialState(rule: CommissionRuleRow | null): FormState {
  if (!rule) {
    return {
      scope: "CATEGORY",
      target: null,
      rateBps: 0,
      fixedPaise: 0,
      startsAt: "",
      endsAt: "",
      note: "",
      isActive: true,
    };
  }
  return {
    scope: rule.scope,
    target: rule.targetId
      ? { id: rule.targetId, title: rule.targetLabel ?? rule.targetId, subtitle: rule.targetSubtitle ?? undefined }
      : null,
    rateBps: rule.rateBps,
    fixedPaise: rule.fixedPaise,
    startsAt: toLocalInput(rule.startsAt),
    endsAt: toLocalInput(rule.endsAt),
    note: rule.note ?? "",
    isActive: rule.isActive,
  };
}

export function CommissionRuleDialog({
  open,
  onOpenChange,
  rule,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create. */
  rule: CommissionRuleRow | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Mounted only while open, and keyed by the rule, so opening a different
          row seeds fresh state by remounting rather than by resetting it in an
          effect (which would render once with the previous rule's values). */}
      {open ? <RuleForm key={rule?.id ?? "new"} rule={rule} onOpenChange={onOpenChange} /> : null}
    </Dialog>
  );
}

function RuleForm({
  rule,
  onOpenChange,
}: {
  rule: CommissionRuleRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { pending, run } = useActionToast();
  const [state, setState] = React.useState<FormState>(() => initialState(rule));
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const isGlobal = state.scope === "GLOBAL";
  const editingGlobal = rule?.scope === "GLOBAL";

  async function submit() {
    const input = {
      scope: state.scope,
      targetId: isGlobal ? null : (state.target?.id ?? null),
      rateBps: state.rateBps ?? 0,
      fixedPaise: state.fixedPaise ?? 0,
      startsAt: state.startsAt || null,
      endsAt: state.endsAt || null,
      note: state.note.trim() || null,
      isActive: state.isActive,
    };

    const result = await run(
      () => (rule ? updateCommissionRuleAction(rule.id, input) : createCommissionRuleAction(input)),
      { onSuccess: () => onOpenChange(false) },
    );
    if (!result.ok) setErrors(result.fieldErrors ?? {});
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{rule ? "Edit commission rule" : "New commission rule"}</DialogTitle>
        <DialogDescription>
          Resolution runs product → seller → nearest category ancestor → global, so the most specific
          rule that is active and inside its window wins.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <FormRow label="Applies to" htmlFor="rule-scope" error={errors.scope} required>
          <div className="flex flex-wrap gap-1.5" id="rule-scope">
            {COMMISSION_SCOPES.filter((scope) => scope !== "GLOBAL" || editingGlobal).map((scope) => (
              <Button
                key={scope}
                type="button"
                size="sm"
                variant={state.scope === scope ? "default" : "outline"}
                // A rule cannot cross the GLOBAL boundary: the key it resolves
                // on would move and every snapshot pointing at it would orphan.
                disabled={editingGlobal}
                onClick={() => setState((prev) => ({ ...prev, scope, target: null }))}
              >
                {COMMISSION_SCOPE_META[scope].label}
              </Button>
            ))}
          </div>
        </FormRow>

        {isGlobal ? (
          <p className="text-muted-foreground text-xs">
            The global rule is the fallback for every sale no other rule covers.
          </p>
        ) : (
          <FormRow
            label={COMMISSION_SCOPE_META[state.scope].label}
            htmlFor="rule-target"
            error={errors.targetId}
            required
          >
            <EntityPicker
              id="rule-target"
              kind={SCOPE_KIND[state.scope as Exclude<CommissionScope, "GLOBAL">]}
              value={state.target}
              onChange={(target) => setState((prev) => ({ ...prev, target }))}
              invalid={Boolean(errors.targetId)}
              placeholder={`Search ${COMMISSION_SCOPE_META[state.scope].label.toLowerCase()}…`}
            />
          </FormRow>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <FormRow label="Rate" htmlFor="rule-rate" error={errors.rateBps} hint="Of the taxable value.">
            <PercentInput
              id="rule-rate"
              valueBps={state.rateBps}
              onChangeBps={(rateBps) => setState((prev) => ({ ...prev, rateBps }))}
              invalid={Boolean(errors.rateBps)}
            />
          </FormRow>
          <FormRow
            label="Fixed per unit"
            htmlFor="rule-fixed"
            error={errors.fixedPaise}
            hint="Added per unit sold."
          >
            <MoneyInput
              id="rule-fixed"
              valuePaise={state.fixedPaise}
              onChangePaise={(fixedPaise) => setState((prev) => ({ ...prev, fixedPaise }))}
              invalid={Boolean(errors.fixedPaise)}
            />
          </FormRow>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormRow label="Starts" htmlFor="rule-starts" error={errors.startsAt} hint="Blank = immediately.">
            <Input
              id="rule-starts"
              type="datetime-local"
              value={state.startsAt}
              onChange={(event) => setState((prev) => ({ ...prev, startsAt: event.target.value }))}
            />
          </FormRow>
          <FormRow label="Ends" htmlFor="rule-ends" error={errors.endsAt} hint="Blank = never expires.">
            <Input
              id="rule-ends"
              type="datetime-local"
              value={state.endsAt}
              onChange={(event) => setState((prev) => ({ ...prev, endsAt: event.target.value }))}
            />
          </FormRow>
        </div>

        <FormRow label="Note" htmlFor="rule-note" error={errors.note} hint="Why this rate exists.">
          <Textarea
            id="rule-note"
            rows={2}
            maxLength={300}
            value={state.note}
            onChange={(event) => setState((prev) => ({ ...prev, note: event.target.value }))}
            placeholder="Negotiated rate for the festive season"
          />
        </FormRow>

        {!editingGlobal ? (
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
            <Label htmlFor="rule-active" className="text-sm font-normal">
              Active
              <span className="text-muted-foreground block text-xs">
                An inactive rule is skipped during resolution.
              </span>
            </Label>
            <Switch
              id="rule-active"
              checked={state.isActive}
              onCheckedChange={(isActive) => setState((prev) => ({ ...prev, isActive }))}
            />
          </div>
        ) : null}

        {errors[""] ? <FieldError>{errors[""]}</FieldError> : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={submit} disabled={pending}>
          {rule ? "Save rule" : "Create rule"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
