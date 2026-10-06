"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { Plus, X } from "lucide-react";

import {
  PAYMENT_PROVIDERS,
  PAYMENT_PROVIDER_META,
  REFUND_METHODS,
  REFUND_METHOD_META,
  REFUND_STATUSES,
  REFUND_STATUS_META,
} from "@/lib/enums";
import { formatPaise } from "@/lib/money";
import { useQueryNav } from "@/hooks/use-query-nav";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { ExportButton } from "@/components/shared/export-button";
import { FilterTabs, SearchInput } from "@/components/shared/list-controls";
import { MoneyInput } from "@/components/shared/money-input";
import { useActionToast } from "@/components/shared/use-action-toast";

import { createRefundAction } from "../actions";
import { SELECTABLE_REFUND_METHODS } from "../schemas";
import type { RefundOrderOption } from "../types";
import type { RefundStatusCounts } from "../queries";

const ALL = "__all";

function UrlSelect({
  paramKey,
  label,
  options,
  className,
}: {
  paramKey: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  className?: string;
}) {
  const searchParams = useSearchParams();
  const { navigate } = useQueryNav();
  const value = searchParams.get(paramKey) ?? ALL;
  return (
    <Select value={value} onValueChange={(next) => navigate({ [paramKey]: next === ALL ? null : next })}>
      <SelectTrigger size="sm" className={className ?? "w-36"} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * "Create refund" from an order. The order is named by its human number
 * because that is what an operator has in front of them; the cap is looked up
 * server-side and the server re-checks it on submit, so a stale dialog cannot
 * over-refund.
 */
export function CreateRefundDialog({
  order,
  open,
  onOpenChange,
}: {
  order: RefundOrderOption | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { navigate } = useQueryNav();
  const { run, pending } = useActionToast();

  const [orderNumber, setOrderNumber] = React.useState(order?.orderNumber ?? "");
  const [amountPaise, setAmountPaise] = React.useState<number | null>(order?.refundableRemainingPaise ?? null);
  const [method, setMethod] = React.useState<string>(order?.hasGatewayPayment ? "ORIGINAL" : "BANK_TRANSFER");
  const [reason, setReason] = React.useState("");
  const [notes, setNotes] = React.useState("");

  // Re-seed the form when the dialog opens or a different order is looked up.
  // Derived-from-props state, written during render rather than in an effect,
  // so opening the dialog does not cost a second render pass.
  const seed = `${open}:${order?.id ?? ""}:${order?.refundableRemainingPaise ?? 0}`;
  const [prevSeed, setPrevSeed] = React.useState(seed);
  if (seed !== prevSeed) {
    setPrevSeed(seed);
    if (open) {
      setOrderNumber(order?.orderNumber ?? "");
      setAmountPaise(order?.refundableRemainingPaise ?? null);
      setMethod(order?.hasGatewayPayment ? "ORIGINAL" : "BANK_TRANSFER");
    }
  }

  const submit = async () => {
    if (!order) return;
    const result = await run(() =>
      createRefundAction({ orderId: order.id, amountPaise: amountPaise ?? 0, method: method as "ORIGINAL", reason, notes: notes || undefined }),
    );
    if (result.ok) {
      onOpenChange(false);
      router.push(`/admin/refunds/${result.data.refundId}` as Route);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a refund</DialogTitle>
          <DialogDescription>
            Refunds can never exceed what the customer actually paid, less everything already pending or settled.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label htmlFor="refund-order">Order number</Label>
            <div className="flex gap-2">
              <Input
                id="refund-order"
                value={orderNumber}
                onChange={(event) => setOrderNumber(event.target.value)}
                placeholder="DB10123"
                className="font-mono"
              />
              <Button type="button" variant="outline" onClick={() => navigate({ order: orderNumber.trim() || null })} disabled={pending}>
                Look up
              </Button>
            </div>
            {order ? (
              <p className="text-muted-foreground text-[11px]">
                {order.customerName} · paid {formatPaise(order.paidPaise)} of {formatPaise(order.totalPaise)} ·{" "}
                <span className="text-foreground font-medium">{formatPaise(order.refundableRemainingPaise)} refundable</span>
              </p>
            ) : (
              <p className="text-muted-foreground text-[11px]">Enter an order number and press Look up.</p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="refund-amount">Amount</Label>
            <MoneyInput id="refund-amount" valuePaise={amountPaise} onChangePaise={setAmountPaise} allowEmpty={false} disabled={!order} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="refund-method">Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="refund-method" disabled={!order}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SELECTABLE_REFUND_METHODS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {REFUND_METHOD_META[value].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {order && !order.hasGatewayPayment ? (
              <p className="text-muted-foreground text-[11px]">
                No online payment was taken on this order, so the money goes back by bank transfer or by hand.
              </p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="refund-reason">Reason</Label>
            <Input id="refund-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this refund being issued?" />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="refund-notes">Internal notes (optional)</Label>
            <Textarea id="refund-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={pending || !order || !amountPaise || amountPaise <= 0 || reason.trim().length < 2}
          >
            Create refund
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RefundsToolbar({
  statusCounts,
  order,
  canProcess,
  canExport,
  hasFilters,
  openCreate,
}: {
  statusCounts: RefundStatusCounts;
  order: RefundOrderOption | null;
  canProcess: boolean;
  canExport: boolean;
  hasFilters: boolean;
  /** True when the URL carried ?order=…, so the dialog opens straight away. */
  openCreate: boolean;
}) {
  const searchParams = useSearchParams();
  const { navigate } = useQueryNav();
  const [createOpen, setCreateOpen] = React.useState(openCreate);

  const exportHref = (format: "csv" | "xlsx" | "print") => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    params.delete("pageSize");
    params.set("format", format);
    return `/api/admin/refunds/export?${params.toString()}`;
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto pb-1">
        <FilterTabs
          paramKey="status"
          allLabel={`All (${statusCounts.all})`}
          options={REFUND_STATUSES.map((status) => ({
            value: status,
            label: REFUND_STATUS_META[status].label,
            count: statusCounts[status],
          }))}
        />
      </div>

      <DataTableToolbar
        search={<SearchInput placeholder="Refund no, order no, customer…" className="w-full sm:w-80" />}
        filters={
          <>
            <UrlSelect
              paramKey="method"
              label="Any method"
              options={REFUND_METHODS.map((method) => ({ value: method, label: REFUND_METHOD_META[method].label }))}
            />
            <UrlSelect
              paramKey="provider"
              label="Any provider"
              options={PAYMENT_PROVIDERS.map((provider) => ({ value: provider, label: PAYMENT_PROVIDER_META[provider].label }))}
            />
            <DateRangePicker />
            {hasFilters ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate({ q: null, status: null, method: null, provider: null, order: null, customer: null, range: null, from: null, to: null })}
              >
                <X /> Clear
              </Button>
            ) : null}
          </>
        }
        actions={
          <>
            {canProcess ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus /> Create refund
              </Button>
            ) : null}
            {canExport ? <ExportButton hrefFor={exportHref} size="sm" /> : null}
          </>
        }
      />

      <CreateRefundDialog order={order} open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
