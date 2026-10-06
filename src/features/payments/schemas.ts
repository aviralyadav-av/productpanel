import {
  PAYMENT_INSTRUMENTS,
  PAYMENT_PROVIDERS,
  PAYMENT_TRANSACTION_STATUSES,
  PAYMENT_TYPES,
  type PaymentInstrument,
  type PaymentProviderCode,
  type PaymentTransactionStatus,
  type PaymentType,
} from "@/lib/enums";
import type { ColumnDef } from "@/components/shared/column-visibility";
import type { SearchParams } from "@/lib/list-params";

/**
 * Client-safe vocabulary for the PAYMENTS module (blueprint §1 Payments, §9).
 *
 * Payments are read-only in the admin: they are written by the checkout, the
 * webhooks and the refunds service. There is therefore no mutation schema
 * here - only the URL shape the list screen speaks. Provider credentials live
 * in Settings (D4) and are never edited from this module.
 */

export const PAYMENT_SORTS = ["created", "amount", "status", "provider", "order", "type"] as const;
export type PaymentSort = (typeof PAYMENT_SORTS)[number];
export function resolvePaymentSort(raw: string | undefined): PaymentSort {
  return (PAYMENT_SORTS as readonly string[]).includes(raw ?? "") ? (raw as PaymentSort) : "created";
}

export const PAYMENT_COLUMNS: ColumnDef[] = [
  { key: "transaction", label: "Transaction", locked: true },
  { key: "order", label: "Order" },
  { key: "customer", label: "Customer" },
  { key: "amount", label: "Amount", locked: true },
  { key: "provider", label: "Gateway" },
  { key: "method", label: "Method" },
  { key: "type", label: "Type" },
  { key: "status", label: "Status", locked: true },
  { key: "created", label: "Date" },
];

export type PaymentListFilters = {
  provider?: PaymentProviderCode;
  method?: PaymentInstrument;
  type?: PaymentType;
  status?: PaymentTransactionStatus;
  orderId?: string;
  customerId?: string;
  range?: string;
  from?: string;
  to?: string;
};

function readParam(params: SearchParams | URLSearchParams, key: string): string | undefined {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.length > 0 ? first : undefined;
}

function pickEnum<T extends string>(list: readonly T[], value: string | undefined): T | undefined {
  return value && (list as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function parsePaymentFilters(params: SearchParams | URLSearchParams): PaymentListFilters {
  return {
    provider: pickEnum(PAYMENT_PROVIDERS, readParam(params, "provider")),
    method: pickEnum(PAYMENT_INSTRUMENTS, readParam(params, "method")),
    type: pickEnum(PAYMENT_TYPES, readParam(params, "type")),
    status: pickEnum(PAYMENT_TRANSACTION_STATUSES, readParam(params, "status")),
    orderId: readParam(params, "order"),
    customerId: readParam(params, "customer"),
    range: readParam(params, "range"),
    from: readParam(params, "from"),
    to: readParam(params, "to"),
  };
}

export function hasPaymentFilters(filters: PaymentListFilters, q: string): boolean {
  return Boolean(
    q ||
      filters.provider ||
      filters.method ||
      filters.type ||
      filters.status ||
      filters.orderId ||
      filters.customerId ||
      filters.range ||
      filters.from ||
      filters.to,
  );
}
