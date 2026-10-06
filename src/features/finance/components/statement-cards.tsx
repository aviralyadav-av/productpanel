import Link from "next/link";
import { AlertTriangle, CheckCircle2, CreditCard, Info } from "lucide-react";
import { cn } from "cn";

import { formatIstDate, formatIstDateTime } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { StatusPill } from "@/components/shared/status-badge";
import { StatusTimeline, type TimelineEvent } from "@/components/shared/status-timeline";

import type { PayoutActivityRow, PayoutDetail, PayoutEntryRow } from "../payout-detail-queries";
import { checkStatementIdentity, maskAccountNumber, statementLines, type BankSnapshot } from "../ui-identity";

/**
 * The read-only halves of a payout statement (blueprint §14.B5, D4).
 *
 * Server Components: nothing here is interactive, and keeping the money out of
 * the client bundle means the totals cannot be re-derived (or mis-derived) in
 * the browser.
 */

// ---------------------------------------------------------------------------
// Totals + the B5 identity check
// ---------------------------------------------------------------------------

export function StatementTotalsCard({ payout }: { payout: PayoutDetail }) {
  const lines = statementLines(payout);
  const check = checkStatementIdentity(payout, payout.ledgerSumPaise);

  return (
    <section className="surface p-4">
      <h2 className="mb-3 text-sm font-semibold">Totals</h2>

      <dl className="space-y-1.5">
        {lines.map((line) => (
          <div
            key={line.key}
            className={cn(
              "flex items-baseline justify-between gap-3",
              line.sign === "total" && "mt-2 border-t pt-2",
            )}
          >
            <dt className={cn("text-xs", line.sign === "total" && "text-sm font-semibold")}>
              {line.label}
              {line.hint ? (
                <span className="text-muted-foreground block text-[11px] font-normal">{line.hint}</span>
              ) : null}
            </dt>
            <dd
              className={cn(
                "text-xs tabular-nums",
                line.sign === "total" && "text-base font-semibold",
                line.sign === "minus" && "text-destructive",
              )}
            >
              {line.sign === "minus" ? "−" : ""}
              {formatPaise(line.paise)}
            </dd>
          </div>
        ))}
      </dl>

      {/* The identity is SHOWN, not merely asserted at write time: an operator
          approving a transfer should be able to see that the number they are
          approving is the one the ledger holds. */}
      <div
        className={cn(
          "mt-3 flex items-start gap-2 rounded-md p-2.5 text-[11px]",
          check.balanced ? "bg-success-muted text-success" : "bg-destructive/10 text-destructive",
        )}
      >
        {check.balanced ? (
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
        ) : (
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        )}
        <div>
          <p className="font-medium">{check.message}</p>
          <p className="opacity-80">{check.formula}</p>
          {check.balanced ? null : (
            <p className="mt-1">
              Stored net {formatPaise(check.netPaise)} · formula {formatPaise(check.expectedPaise)}
              {check.ledgerSumPaise === null ? "" : ` · ledger ${formatPaise(check.ledgerSumPaise)}`}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Bank snapshot (D4: masked, never the full number)
// ---------------------------------------------------------------------------

export function BankSnapshotCard({
  snapshot,
  method,
  status,
}: {
  snapshot: BankSnapshot | null;
  method: string;
  status: string;
}) {
  return (
    <section className="surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <CreditCard className="text-muted-foreground size-4" />
        <h2 className="text-sm font-semibold">Bank account</h2>
      </div>

      {snapshot ? (
        <dl className="space-y-1.5 text-xs">
          <Field label="Account holder" value={snapshot.accountHolder ?? "—"} />
          <Field label="Bank" value={snapshot.bankName ?? "—"} />
          <Field label="Account" value={maskAccountNumber(snapshot.accountNumberLast4)} mono />
          <Field label="IFSC" value={snapshot.ifsc ?? "—"} mono />
          {snapshot.upiId ? <Field label="UPI" value={snapshot.upiId} mono /> : null}
          <Field label="Verified" value={snapshot.isVerified ? "Yes" : "No"} />
          {snapshot.snapshotAt ? (
            <Field label="Snapshotted" value={formatIstDateTime(new Date(snapshot.snapshotAt))} />
          ) : null}
          <p className="text-muted-foreground pt-1 text-[11px]">
            A masked copy taken when the statement moved to processing, so it records where the money went
            even if the seller later changes accounts.
          </p>
        </dl>
      ) : (
        <p className="text-muted-foreground text-xs">
          {status === "PENDING" || status === "APPROVED"
            ? "No account is recorded yet. One is snapshotted when the statement moves to processing."
            : method === "MANUAL"
              ? "Paid manually - no bank account was recorded."
              : "No account was snapshotted for this statement."}
        </p>
      )}
    </section>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono" : undefined}>{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export function StatementEntriesTable({ entries }: { entries: PayoutEntryRow[] }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        compact
        icon={Info}
        title="No entries on this statement"
        description="Every entry was released back to available - this happens when a statement fails or is cancelled."
      />
    );
  }

  const table = (
    <DataTable>
      <DataTableHead>
        <Th>Type</Th>
        <Th>Description</Th>
        <Th>Order</Th>
        <Th align="right">Amount</Th>
        <Th>Available at</Th>
        <Th>Status</Th>
      </DataTableHead>
      <DataTableBody>
        {entries.map((entry) => (
          <Tr key={entry.id}>
            <Td>
              <StatusPill label={entry.typeLabel} tone={entry.typeTone} />
            </Td>
            <Td>
              <span className="block max-w-[24rem] truncate text-xs" title={entry.description}>
                {entry.description}
              </span>
              {entry.itemTitle ? (
                <span className="text-muted-foreground block max-w-[24rem] truncate text-[11px]">
                  {entry.itemTitle}
                </span>
              ) : null}
            </Td>
            <Td>
              {entry.orderHref && entry.orderNumber ? (
                <Link href={entry.orderHref} className="font-mono text-[11px] hover:underline">
                  {entry.orderNumber}
                </Link>
              ) : (
                <span className="text-muted-foreground/70 text-xs">—</span>
              )}
            </Td>
            <Td align="right" numeric className="text-xs font-medium">
              <span className={entry.amountPaise < 0 ? "text-destructive" : "text-success"}>
                {entry.amountPaise < 0 ? "−" : "+"}
                {formatPaise(Math.abs(entry.amountPaise))}
              </span>
            </Td>
            <Td numeric className="text-xs">
              {entry.availableAt ? formatIstDate(new Date(entry.availableAt)) : "—"}
            </Td>
            <Td>
              <StatusPill label={entry.statusLabel} tone={entry.statusTone} />
            </Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = entries.map((entry) => (
    <MobileCard
      key={entry.id}
      title={entry.typeLabel}
      subtitle={entry.orderNumber ?? undefined}
      meta={<StatusPill label={entry.statusLabel} tone={entry.statusTone} />}
    >
      <MobileCardField label="Amount" numeric>
        {entry.amountPaise < 0 ? "−" : "+"}
        {formatPaise(Math.abs(entry.amountPaise))}
      </MobileCardField>
      <MobileCardField label="Description">{entry.description}</MobileCardField>
    </MobileCard>
  ));

  return <ResponsiveTable table={table} cards={cards} />;
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export function StatementActivityCard({ rows }: { rows: PayoutActivityRow[] }) {
  const events: TimelineEvent[] = rows.map((row) => ({
    id: row.id,
    title: row.summary,
    description: row.ip ? `${row.action} · ${row.ip}` : row.action,
    at: new Date(row.createdAt),
    actor: row.actorEmail,
    tone: row.action.endsWith("fail") ? "danger" : row.action.endsWith("paid") ? "success" : "neutral",
  }));

  return (
    <section className="surface p-4">
      <h2 className="mb-3 text-sm font-semibold">Activity</h2>
      <StatusTimeline events={events} emptyText="Nothing has happened to this statement yet." />
    </section>
  );
}
