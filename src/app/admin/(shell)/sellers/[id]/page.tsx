import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requirePermission } from "@/lib/auth/guards";
import { one, parseListParams, type SearchParams } from "@/lib/list-params";

import { BankAccountsTab } from "@/features/sellers/components/bank-accounts-tab";
import { OrdersTab, ProductsTab, ReviewsTab } from "@/features/sellers/components/catalog-tabs";
import { CommissionTab } from "@/features/sellers/components/commission-tab";
import { DocumentsTab } from "@/features/sellers/components/documents-tab";
import { EarningsTab } from "@/features/sellers/components/earnings-tab";
import { OverviewTab } from "@/features/sellers/components/overview-tab";
import { ActivityTab, PerformanceTab } from "@/features/sellers/components/performance-activity-tabs";
import { SellerHeader, SellerTabNav, SellerWorkflowStepper } from "@/features/sellers/components/seller-detail-shell";
import { SellerForm } from "@/features/sellers/components/seller-form";
import {
  getSellerCommissionInfo,
  getSellerDetail,
  getSellerOverview,
  getSellerPerformance,
  listSellerActivity,
  listSellerBankAccounts,
  listSellerDocuments,
  listSellerLedger,
  listSellerOrders,
  listSellerPayouts,
  listSellerProducts,
  listSellerReviews,
} from "@/features/sellers/detail-queries";
import { parseLedgerStatus, parseLedgerType, parseSellerTab, type SellerTab } from "@/features/sellers/schemas";
import type { SellerDetail } from "@/features/sellers/types";

export const metadata: Metadata = { title: "Seller" };

/**
 * /admin/sellers/[id]?tab= (blueprint §1 Sellers, §14.C5, B3, B4, D4).
 * The header and workflow stepper always load; the open tab decides which
 * extra query runs, so a seller with ten thousand ledger rows does not pay
 * for them while an operator is checking documents.
 */
export default async function SellerDetailPage({ params, searchParams }: PageProps<"/admin/sellers/[id]">) {
  await requirePermission("sellers.view");
  const { id } = await params;
  const query = (await searchParams) as SearchParams;
  const tab = parseSellerTab(one(query, "tab"));

  const seller = await getSellerDetail(id);
  if (!seller) notFound();

  return (
    <div className="space-y-4">
      <SellerHeader seller={seller} />
      <SellerWorkflowStepper seller={seller} />
      <SellerTabNav sellerId={seller.id} active={tab} />
      <TabContent tab={tab} seller={seller} query={query} />
    </div>
  );
}

async function TabContent({ tab, seller, query }: { tab: SellerTab; seller: SellerDetail; query: SearchParams }) {
  const list = parseListParams(query, { pageSize: 20 });

  switch (tab) {
    case "profile":
      return <SellerForm key={seller.updatedAt} seller={seller} />;
    case "documents":
      return <DocumentsTab sellerId={seller.id} rows={await listSellerDocuments(seller.id)} />;
    case "bank":
      return <BankAccountsTab sellerId={seller.id} rows={await listSellerBankAccounts(seller.id)} />;
    case "commission":
      return <CommissionTab key={seller.updatedAt} sellerId={seller.id} info={await getSellerCommissionInfo(seller.id)} />;
    case "products": {
      const result = await listSellerProducts(seller.id, list);
      return <ProductsTab rows={result.rows} meta={result.meta} />;
    }
    case "orders": {
      const result = await listSellerOrders(seller.id, list);
      return <OrdersTab groups={result.groups} meta={result.meta} />;
    }
    case "earnings": {
      const [ledger, payouts] = await Promise.all([
        listSellerLedger(seller.id, list, { type: parseLedgerType(one(query, "type")), status: parseLedgerStatus(one(query, "status")) }),
        listSellerPayouts(seller.id),
      ]);
      return <EarningsTab seller={seller} ledger={ledger.rows} meta={ledger.meta} payouts={payouts} />;
    }
    case "reviews": {
      const result = await listSellerReviews(seller.id, list);
      return <ReviewsTab sellerId={seller.id} rows={result.rows} meta={result.meta} />;
    }
    case "performance":
      return <PerformanceTab performance={await getSellerPerformance(seller.id)} />;
    case "activity":
      return <ActivityTab rows={await listSellerActivity(seller.id)} />;
    case "overview":
    default:
      return <OverviewTab seller={seller} overview={await getSellerOverview(seller.id)} />;
  }
}
