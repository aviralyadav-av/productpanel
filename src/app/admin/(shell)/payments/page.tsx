import type { Metadata } from "next";

import { can, requirePermission } from "@/lib/auth/guards";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { formatNumber, formatPaise } from "@/lib/money";
import { PaginationBar } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";

import { PaymentsTable } from "@/features/payments/components/payments-table";
import { PaymentsToolbar } from "@/features/payments/components/payments-toolbar";
import { listPayments, paymentKpis } from "@/features/payments/queries";
import { hasPaymentFilters, parsePaymentFilters, resolvePaymentSort } from "@/features/payments/schemas";

export const metadata: Metadata = { title: "Payments" };

/**
 * /admin/payments (blueprint §1 Payments, §9).
 *
 * Read-only by design: rows are written by the checkout, by gateway webhooks,
 * by the manual-payment action on an order and by the refunds service. Nothing
 * on this screen can change money — it exists to answer "did it arrive".
 */
export default async function PaymentsPage({ searchParams }: PageProps<"/admin/payments">) {
  const actor = await requirePermission("payments.view");

  const params = (await searchParams) as SearchParams;
  const listParams = parseListParams(params, { defaultSort: "created", defaultOrder: "desc" });
  const filters = parsePaymentFilters(params);
  const sort = resolvePaymentSort(listParams.sort);

  const [list, kpis] = await Promise.all([listPayments({ ...listParams, sort }, filters), paymentKpis()]);
  const hasFilters = hasPaymentFilters(filters, listParams.q);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payments"
        description="Every charge and every refund leg, whichever rail it travelled. Provider credentials and test/live mode live in Settings."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Collected today" value={formatPaise(kpis.collectedTodayPaise)} hint="Successful charges, IST day" />
        <StatCard label="Collected this month" value={formatPaise(kpis.collectedMonthPaise)} hint="IST month to date" />
        <StatCard label="Pending" value={formatNumber(kpis.pending)} hint="Attempts awaiting a gateway answer" higherIsBetter={false} />
        <StatCard
          label="Failed this month"
          value={formatNumber(kpis.failed)}
          hint={`${formatPaise(kpis.refundedMonthPaise)} refunded this month`}
          higherIsBetter={false}
        />
      </div>

      <PaymentsToolbar canExport={can(actor, "payments.view")} canManage={can(actor, "payments.manage")} hasFilters={hasFilters} />

      <PaymentsTable rows={list.rows} meta={list.meta} sort={sort} order={listParams.order} hasFilters={hasFilters} />

      {list.meta.totalPages > 1 ? <PaginationBar meta={list.meta} itemLabel="transactions" /> : null}
    </div>
  );
}
