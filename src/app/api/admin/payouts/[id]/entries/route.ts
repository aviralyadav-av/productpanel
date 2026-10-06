import { apiOk, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";
import { exportRows, parseExportFormat } from "@/lib/export";

import { getPayoutDetail } from "@/features/finance/payout-detail-queries";
import { LEDGER_EXPORT_COLUMNS } from "@/features/finance/export";

/**
 * GET /api/admin/payouts/:id/entries[?format=csv|xlsx]   (payouts.view)
 *
 * JSON by default; `format` streams the same rows as a file, which is what the
 * "Download CSV" button on the statement uses. A statement's entries are
 * bounded (they are one period for one seller), so this does not page.
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params, searchParams }) => {
    const payout = await getPayoutDetail(params.id);
    if (!payout) throw notFound("Payout");

    const format = searchParams.get("format");
    if (!format) {
      return apiOk({
        entries: payout.entries,
        ledgerSumPaise: payout.ledgerSumPaise,
        netPaise: payout.netPaise,
      });
    }

    return exportRows({
      format: parseExportFormat(format),
      filename: `${payout.payoutNumber}-entries`,
      title: `${payout.payoutNumber} · ${payout.seller.name}`,
      columns: LEDGER_EXPORT_COLUMNS,
      rows: payout.entries.map((entry) => ({
        createdAt: entry.createdAt,
        sellerName: payout.seller.name,
        typeLabel: entry.typeLabel,
        amountPaise: entry.amountPaise,
        statusLabel: entry.statusLabel,
        availableAt: entry.availableAt,
        description: entry.description,
        orderNumber: entry.orderNumber,
        itemTitle: entry.itemTitle,
        payoutNumber: payout.payoutNumber,
      })),
    });
  },
  { permission: "payouts.view" },
);
