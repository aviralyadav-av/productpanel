"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EntityPicker, type EntityRef } from "@/components/shared/entity-picker";
import { ExportButton } from "@/components/shared/export-button";
import { useQueryNav } from "@/hooks/use-query-nav";
import {
  LEDGER_ENTRY_STATUSES,
  LEDGER_ENTRY_STATUS_META,
  LEDGER_ENTRY_TYPES,
  LEDGER_ENTRY_TYPE_META,
} from "@/lib/enums";

/**
 * URL-writing filter controls for /admin/payouts. Each writes exactly one
 * search param and nothing else, so the page stays a Server Component that
 * reads its whole state back from the URL.
 */

/** `?seller=<id>`; the chip is hydrated server-side so it paints immediately. */
export function SellerFilter({ seller }: { seller: EntityRef | null }) {
  const { navigate } = useQueryNav();
  return (
    <div className="w-full sm:w-56">
      <EntityPicker
        kind="seller"
        value={seller}
        onChange={(value) => navigate({ seller: value?.id ?? null })}
        placeholder="Any seller"
      />
    </div>
  );
}

/** `?type=` on the ledger tab. */
export function LedgerTypeFilter({ value }: { value?: string }) {
  const { navigate } = useQueryNav();
  return (
    <Select value={value ?? "all"} onValueChange={(next) => navigate({ type: next === "all" ? null : next })}>
      <SelectTrigger size="sm" className="w-44" aria-label="Entry type">
        <SelectValue placeholder="Any type" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Any type</SelectItem>
        {LEDGER_ENTRY_TYPES.map((type) => (
          <SelectItem key={type} value={type}>
            {LEDGER_ENTRY_TYPE_META[type].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * `?lstatus=` on the ledger tab. Deliberately not `status`: the statements tab
 * shares this URL and a bookmarked statement filter must not reappear as a
 * ledger filter.
 */
export function LedgerStatusFilter({ value }: { value?: string }) {
  const { navigate } = useQueryNav();
  return (
    <Select value={value ?? "all"} onValueChange={(next) => navigate({ lstatus: next === "all" ? null : next })}>
      <SelectTrigger size="sm" className="w-44" aria-label="Entry status">
        <SelectValue placeholder="Any status" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Any status</SelectItem>
        {LEDGER_ENTRY_STATUSES.map((status) => (
          <SelectItem key={status} value={status}>
            {LEDGER_ENTRY_STATUS_META[status].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Exports carry the CURRENT filters, so what downloads is what is on screen -
 * the whole filtered set, not just the visible page (the route streams it).
 */
export function PayoutExportButton({ scope }: { scope: "statements" | "ledger" }) {
  const { searchParams } = useQueryNav();
  const base = scope === "statements" ? "/api/admin/payouts/export" : "/api/admin/payouts/ledger/export";

  return (
    <ExportButton
      formats={["csv", "xlsx"]}
      hrefFor={(format) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("format", format);
        return `${base}?${params.toString()}`;
      }}
    />
  );
}
