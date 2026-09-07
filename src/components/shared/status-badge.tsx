import { cn } from "cn";

import type { BadgeTone } from "@/lib/enums";
import {
  CUSTOMER_STATUS_META,
  ORDER_STATUS_META,
  PAYMENT_STATUS_META,
  PRODUCT_STATUS_META,
  REVIEW_STATUS_META,
  STOCK_STATE_META,
  type CustomerStatus,
  type OrderStatus,
  type PaymentStatus,
  type ProductStatus,
  type ReviewStatus,
  type StockState,
} from "@/lib/enums";

/**
 * One badge component for every status in the app, so a colour always means
 * the same thing. Tones use a tinted background with a matching foreground
 * rather than a solid fill: at the density of an admin table, solid colour
 * chips turn a list into a fruit salad.
 */
const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-muted text-muted-foreground border-transparent",
  brand: "bg-brand-muted text-brand border-transparent",
  success: "bg-success-muted text-success border-transparent",
  warning: "bg-warning-muted text-warning border-transparent",
  danger: "bg-destructive/10 text-destructive border-transparent",
  info: "bg-info-muted text-info border-transparent",
};

const DOT_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-muted-foreground/60",
  brand: "bg-brand",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
};

export function StatusPill({
  label,
  tone = "neutral",
  dot = true,
  className,
}: {
  label: string;
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        TONE_CLASS[tone],
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full", DOT_CLASS[tone])}
        />
      ) : null}
      {label}
    </span>
  );
}

export function OrderStatusBadge({ status }: { status: string }) {
  const meta = ORDER_STATUS_META[status as OrderStatus];
  return <StatusPill label={meta?.label ?? status} tone={meta?.tone ?? "neutral"} />;
}

export function PaymentStatusBadge({
  status,
  method,
}: {
  status: string;
  method?: string;
}) {
  const meta = PAYMENT_STATUS_META[status as PaymentStatus];
  const label = method ? `${method} · ${meta?.label ?? status}` : meta?.label ?? status;
  return <StatusPill label={label} tone={meta?.tone ?? "neutral"} />;
}

export function ProductStatusBadge({ status }: { status: string }) {
  const meta = PRODUCT_STATUS_META[status as ProductStatus];
  return <StatusPill label={meta?.label ?? status} tone={meta?.tone ?? "neutral"} />;
}

export function StockBadge({ state }: { state: StockState }) {
  const meta = STOCK_STATE_META[state];
  return <StatusPill label={meta.label} tone={meta.tone} />;
}

export function ReviewStatusBadge({ status }: { status: string }) {
  const meta = REVIEW_STATUS_META[status as ReviewStatus];
  return <StatusPill label={meta?.label ?? status} tone={meta?.tone ?? "neutral"} />;
}

export function CustomerStatusBadge({ status }: { status: string }) {
  const meta = CUSTOMER_STATUS_META[status as CustomerStatus];
  return <StatusPill label={meta?.label ?? status} tone={meta?.tone ?? "neutral"} />;
}
