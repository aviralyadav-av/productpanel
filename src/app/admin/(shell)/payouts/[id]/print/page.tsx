import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requirePermission } from "@/lib/auth/guards";
import { PAYOUT_METHOD_META, PAYOUT_STATUS_META } from "@/lib/enums";
import { formatIstDate, formatIstDateTime } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { PrintButton } from "@/components/shared/export-button";

import { getPayoutDetail, getStatementIdentity } from "@/features/finance/payout-detail-queries";
import { checkStatementIdentity, maskAccountNumber, statementLines } from "@/features/finance/ui-identity";

export const metadata: Metadata = { title: "Payout statement" };

/**
 * /admin/payouts/[id]/print - the paper version of a statement.
 *
 * Deliberately self-contained plain HTML with its own print rules rather than
 * the admin shell's components: what a seller receives (or what is filed
 * against a bank transfer) should not change because a shared card gained a
 * hover state, and everything interactive is hidden at print time.
 */
export default async function PayoutPrintPage({ params }: PageProps<"/admin/payouts/[id]/print">) {
  await requirePermission("payouts.view");
  const { id } = await params;

  const [payout, store] = await Promise.all([getPayoutDetail(id), getStatementIdentity()]);
  if (!payout) notFound();

  const lines = statementLines(payout);
  const check = checkStatementIdentity(payout, payout.ledgerSumPaise);

  return (
    <div className="mx-auto max-w-3xl space-y-5 bg-white p-6 text-black print:p-0">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { margin: 14mm; }
        }
      `}</style>

      <div className="no-print flex justify-end">
        <PrintButton label="Print" />
      </div>

      <header className="flex items-start justify-between gap-6 border-b border-neutral-300 pb-4">
        <div>
          <h1 className="text-lg font-semibold">{store.name}</h1>
          {store.address ? <p className="max-w-xs text-[11px] leading-snug">{store.address}</p> : null}
          <p className="text-[11px]">
            {[store.email, store.phone].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wide">Payout statement</p>
          <p className="font-mono text-base font-semibold">{payout.payoutNumber}</p>
          <p className="text-[11px]">{PAYOUT_STATUS_META[payout.status].label}</p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-6 text-[11px]">
        <div>
          <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wide">Seller</h2>
          <p className="text-sm font-medium">{payout.seller.name}</p>
          <p>{payout.seller.email}</p>
          {[payout.seller.city, payout.seller.state].filter(Boolean).length > 0 ? (
            <p>{[payout.seller.city, payout.seller.state].filter(Boolean).join(", ")}</p>
          ) : null}
          {payout.seller.gstin ? <p>GSTIN {payout.seller.gstin}</p> : null}
          {payout.seller.pan ? <p>PAN {payout.seller.pan}</p> : null}
        </div>
        <div>
          <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wide">Statement</h2>
          <Row label="Period" value={`${formatIstDate(new Date(payout.periodFrom))} – ${formatIstDate(new Date(payout.periodTo))}`} />
          <Row label="Generated" value={formatIstDateTime(new Date(payout.createdAt))} />
          <Row label="Method" value={PAYOUT_METHOD_META[payout.method].label} />
          {payout.paidAt ? <Row label="Paid" value={formatIstDateTime(new Date(payout.paidAt))} /> : null}
          {payout.referenceNumber ? <Row label="Reference" value={payout.referenceNumber} /> : null}
        </div>
      </section>

      <section>
        <h2 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide">Summary</h2>
        <table className="w-full text-[11px]">
          <tbody>
            {lines.map((line) => (
              <tr key={line.key} className={line.sign === "total" ? "border-t border-neutral-300" : undefined}>
                <td className={`py-1 ${line.sign === "total" ? "font-semibold" : ""}`}>{line.label}</td>
                <td className={`py-1 text-right tabular-nums ${line.sign === "total" ? "text-sm font-semibold" : ""}`}>
                  {line.sign === "minus" ? "−" : ""}
                  {formatPaise(line.paise)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-[10px] text-neutral-600">
          {check.formula}
          {check.balanced ? "" : " — WARNING: this statement does not reconcile with its ledger entries."}
        </p>
      </section>

      {payout.bankSnapshot ? (
        <section className="text-[11px]">
          <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wide">Paid to</h2>
          <p>{payout.bankSnapshot.accountHolder ?? "—"}</p>
          <p>
            {payout.bankSnapshot.bankName ?? "—"} · {maskAccountNumber(payout.bankSnapshot.accountNumberLast4)}
            {payout.bankSnapshot.ifsc ? ` · ${payout.bankSnapshot.ifsc}` : ""}
          </p>
        </section>
      ) : null}

      <section>
        <h2 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide">
          Entries ({payout.entries.length})
        </h2>
        <table className="w-full text-[10px]">
          <thead>
            <tr className="border-b border-neutral-300 text-left">
              <th className="py-1">Date</th>
              <th className="py-1">Type</th>
              <th className="py-1">Description</th>
              <th className="py-1">Order</th>
              <th className="py-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {payout.entries.map((entry) => (
              <tr key={entry.id} className="border-b border-neutral-200 align-top">
                <td className="py-1 whitespace-nowrap">{formatIstDate(new Date(entry.createdAt))}</td>
                <td className="py-1 whitespace-nowrap">{entry.typeLabel}</td>
                <td className="py-1">{entry.description}</td>
                <td className="py-1 whitespace-nowrap">{entry.orderNumber ?? "—"}</td>
                <td className="py-1 text-right tabular-nums whitespace-nowrap">
                  {entry.amountPaise < 0 ? "−" : "+"}
                  {formatPaise(Math.abs(entry.amountPaise))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {payout.notes ? (
        <section className="text-[11px]">
          <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wide">Notes</h2>
          <p className="whitespace-pre-wrap">{payout.notes}</p>
        </section>
      ) : null}

      <footer className="border-t border-neutral-300 pt-3 text-[10px] text-neutral-600">
        Computer-generated statement · {formatIstDateTime(new Date())}
      </footer>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-neutral-600">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
