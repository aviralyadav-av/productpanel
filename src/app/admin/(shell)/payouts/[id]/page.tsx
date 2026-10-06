import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, Printer } from "lucide-react";

import { requirePermission } from "@/lib/auth/guards";
import { PAYOUT_METHOD_META, PAYOUT_STATUS_META } from "@/lib/enums";
import { formatIstDate, formatIstDateTime } from "@/lib/dates";
import { formatNumber, formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusPill } from "@/components/shared/status-badge";
import { Stepper } from "@/components/shared/stepper";

import {
  BankSnapshotCard,
  StatementActivityCard,
  StatementEntriesTable,
  StatementTotalsCard,
} from "@/features/finance/components/statement-cards";
import { StatementHeaderActions } from "@/features/finance/components/statement-header-actions";
import { getPayoutDetail, listPayoutActivity } from "@/features/finance/payout-detail-queries";
import { payoutStepIndex, payoutSteps } from "@/features/finance/ui-identity";

export const metadata: Metadata = { title: "Payout statement" };

/**
 * /admin/payouts/[id] (blueprint §14.B5, §10 payout flow).
 *
 * One statement, end to end: where it is in the flow, what it adds up to (with
 * the B5 identity shown, not just asserted), where the money went, which
 * ledger rows it carries, and who moved it.
 */
export default async function PayoutDetailPage({ params }: PageProps<"/admin/payouts/[id]">) {
  await requirePermission("payouts.view");
  const { id } = await params;

  const payout = await getPayoutDetail(id);
  if (!payout) notFound();

  const activity = await listPayoutActivity(payout.id);
  const steps = payoutSteps(payout.status);

  return (
    <div className="space-y-4">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={"/admin/payouts?tab=statements" as Route}>
            <ArrowLeft />
            All statements
          </Link>
        </Button>
      </div>

      <PageHeader
        title={payout.payoutNumber}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={payout.seller.href} className="underline">
              {payout.seller.name}
            </Link>
            <span className="text-muted-foreground">·</span>
            <span>
              {formatIstDate(new Date(payout.periodFrom))} – {formatIstDate(new Date(payout.periodTo))}
            </span>
            <span className="text-muted-foreground">·</span>
            <span>{PAYOUT_METHOD_META[payout.method].label}</span>
            <StatusPill
              label={PAYOUT_STATUS_META[payout.status].label}
              tone={PAYOUT_STATUS_META[payout.status].tone}
            />
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={`/api/admin/payouts/${payout.id}/entries?format=csv`}>
                <Download />
                Entries CSV
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/payouts/${payout.id}/print` as Route} target="_blank">
                <Printer />
                Print statement
              </Link>
            </Button>
            <StatementHeaderActions
              payoutId={payout.id}
              payoutNumber={payout.payoutNumber}
              status={payout.status}
              netPaise={payout.netPaise}
              method={payout.method}
              bankAccounts={payout.bankAccounts}
              currentBankAccountId={payout.bankAccountId}
            />
          </div>
        }
      />

      <section className="surface p-4">
        <Stepper steps={steps} currentIndex={payoutStepIndex(payout.status)} />
        {payout.failureReason ? (
          <p className="text-destructive mt-3 text-xs">{payout.failureReason}</p>
        ) : null}
        <dl className="text-muted-foreground mt-3 grid grid-cols-2 gap-3 text-[11px] sm:grid-cols-4">
          <Stamp label="Created" at={payout.createdAt} by={payout.createdByName} />
          <Stamp label="Approved" at={payout.approvedAt} by={payout.approvedByName} />
          <Stamp label="Processing" at={payout.processedAt} />
          <Stamp label="Paid" at={payout.paidAt} by={payout.referenceNumber} />
        </dl>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <StatementTotalsCard payout={payout} />
        <BankSnapshotCard
          snapshot={payout.bankSnapshot}
          method={payout.method}
          status={payout.status}
        />
        <StatementActivityCard rows={activity} />
      </div>

      {payout.notes ? (
        <section className="surface p-4">
          <h2 className="mb-1.5 text-sm font-semibold">Notes</h2>
          <p className="text-muted-foreground whitespace-pre-wrap text-xs">{payout.notes}</p>
        </section>
      ) : null}

      <section className="surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
          <h2 className="text-sm font-semibold">
            Ledger entries
            <span className="text-muted-foreground ml-1.5 text-xs font-normal">
              {formatNumber(payout.entries.length)} · signed sum {formatPaise(payout.ledgerSumPaise)}
            </span>
          </h2>
          <Button asChild variant="outline" size="sm">
            <a href={`/api/admin/payouts/${payout.id}/entries?format=csv`}>
              <Download />
              Download CSV
            </a>
          </Button>
        </div>
        <StatementEntriesTable entries={payout.entries} />
      </section>
    </div>
  );
}

function Stamp({ label, at, by }: { label: string; at: Date | null; by?: string | null }) {
  return (
    <div>
      <dt className="uppercase tracking-wide">{label}</dt>
      <dd className="text-foreground">
        {at ? formatIstDateTime(new Date(at)) : "—"}
        {by ? <span className="text-muted-foreground block truncate">{by}</span> : null}
      </dd>
    </div>
  );
}
