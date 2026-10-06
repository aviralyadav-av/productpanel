import { Star } from "lucide-react";
import { cn } from "cn";

import {
  LEDGER_ENTRY_STATUS_META,
  LEDGER_ENTRY_TYPE_META,
  PAYOUT_STATUS_META,
  SELLER_DOCUMENT_STATUS_META,
  SELLER_DOCUMENT_TYPE_META,
  SELLER_STATUS_META,
  type LedgerEntryStatus,
  type LedgerEntryType,
  type PayoutStatus,
  type SellerDocumentStatus,
  type SellerDocumentType,
  type SellerStatus,
} from "@/lib/enums";
import { StatusPill } from "@/components/shared/status-badge";

/**
 * Seller-domain badges built on the shared StatusPill so a colour means the
 * same thing here as on the payouts and ledger screens. Server-compatible.
 */

export function SellerStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = SELLER_STATUS_META[status as SellerStatus];
  return <StatusPill label={meta?.label ?? status} tone={meta?.tone ?? "neutral"} className={className} />;
}

export function DocumentStatusBadge({ status }: { status: string }) {
  const meta = SELLER_DOCUMENT_STATUS_META[status as SellerDocumentStatus];
  return <StatusPill label={meta?.label ?? status} tone={meta?.tone ?? "neutral"} />;
}

export function documentTypeLabel(type: string): string {
  return SELLER_DOCUMENT_TYPE_META[type as SellerDocumentType]?.label ?? type;
}

export function LedgerTypeBadge({ type }: { type: string }) {
  const meta = LEDGER_ENTRY_TYPE_META[type as LedgerEntryType];
  return <StatusPill label={meta?.label ?? type} tone={meta?.tone ?? "neutral"} dot={false} />;
}

export function LedgerStatusBadge({ status }: { status: string }) {
  const meta = LEDGER_ENTRY_STATUS_META[status as LedgerEntryStatus];
  return <StatusPill label={meta?.label ?? status} tone={meta?.tone ?? "neutral"} />;
}

export function PayoutStatusBadge({ status }: { status: string }) {
  const meta = PAYOUT_STATUS_META[status as PayoutStatus];
  return <StatusPill label={meta?.label ?? status} tone={meta?.tone ?? "neutral"} />;
}

/** "4.6 ★ (12)" - an em dash when nobody has rated yet, not a misleading 0.0. */
export function RatingText({ avg, count, className }: { avg: number; count: number; className?: string }) {
  if (count === 0) return <span className={cn("text-muted-foreground/70", className)}>&mdash;</span>;
  return (
    <span data-numeric className={cn("inline-flex items-center gap-1 whitespace-nowrap", className)}>
      {avg.toFixed(1)}
      <Star className="text-warning size-3 fill-current" aria-hidden />
      <span className="text-muted-foreground">({count})</span>
    </span>
  );
}

/** "3/4 verified" with a warning tint while anything is still pending. */
export function DocsProgress({ verified, total, pending }: { verified: number; total: number; pending: number }) {
  if (total === 0) return <span className="text-muted-foreground/70 text-[11px]">No documents</span>;
  return (
    <span
      data-numeric
      className={cn("text-[11px]", pending > 0 ? "text-warning" : verified === total ? "text-success" : "text-muted-foreground")}
      title={`${verified} verified, ${pending} pending, ${total - verified - pending} rejected`}
    >
      {verified}/{total} verified
    </span>
  );
}
