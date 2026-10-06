import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requirePermission } from "@/lib/auth/guards";
import { formatIstDate } from "@/lib/dates";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { PageHeader } from "@/components/shared/page-header";
import { CustomerStatusBadge, StatusPill } from "@/components/shared/status-badge";

import { AddressBook } from "@/features/customers/components/address-book";
import { CustomerForm } from "@/features/customers/components/customer-form";
import { CustomerHeaderActions, DangerZone } from "@/features/customers/components/customer-header-actions";
import { SegmentBadge } from "@/features/customers/components/customer-list";
import { CustomerTabs } from "@/features/customers/components/customer-tabs";
import { ActivityTab, ReviewsTab, WishlistTab } from "@/features/customers/components/engagement-tabs";
import { OrdersTab, PaymentsTab, RefundsTab, ReturnsTab } from "@/features/customers/components/history-tabs";
import { OverviewTab } from "@/features/customers/components/overview-tab";
import { resolveTab, type CustomerTab } from "@/features/customers/filters";
import {
  getCustomerActivity,
  getCustomerAddresses,
  getCustomerDetail,
  getCustomerOrders,
  getCustomerOverview,
  getCustomerPayments,
  getCustomerRefunds,
  getCustomerReturns,
  getCustomerReviews,
  getCustomerWishlist,
  getTagSuggestions,
} from "@/features/customers/queries";

export const metadata: Metadata = { title: "Customer" };

/**
 * /admin/customers/[id] - the profile. The header and tab strip always load;
 * only the active tab's data is queried, so a customer with 400 orders opens
 * as fast as one with none.
 */
export default async function CustomerDetailPage({ params, searchParams }: PageProps<"/admin/customers/[id]">) {
  const actor = await requirePermission("customers.view");
  const { id } = await params;
  const query = (await searchParams) as SearchParams;
  const tab = resolveTab(typeof query.tab === "string" ? query.tab : undefined);

  const customer = await getCustomerDetail(id);
  if (!customer) notFound();

  const permissions = actor.isSuperAdmin ? ["*"] : [...actor.permissions];
  const can = (code: string) => permissions.includes("*") || permissions.includes(code);
  const editable = can("customers.edit") && !customer.deletedAt;
  const name = customer.fullName ?? customer.email;

  const counts: Partial<Record<CustomerTab, number>> = {
    addresses: customer.counts.addresses,
    orders: customer.counts.orders,
    wishlist: customer.counts.wishlist,
    reviews: customer.counts.reviews,
    returns: customer.counts.returns,
    refunds: customer.counts.refunds,
    payments: customer.counts.payments,
    activity: customer.counts.sessions,
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{customer.email}</span>
            {customer.phone ? <span data-numeric>{customer.phone}</span> : null}
            <span>Member since {formatIstDate(customer.createdAt)}</span>
            {customer.deletedAt ? <StatusPill label={`Deleted ${formatIstDate(customer.deletedAt)}`} tone="neutral" /> : <CustomerStatusBadge status={customer.status} />}
            <SegmentBadge segment={customer.segment} />
          </span>
        }
        actions={<CustomerHeaderActions customer={customer} permissions={permissions} />}
      />

      <CustomerTabs customerId={customer.id} active={tab} counts={counts} />

      <TabBody tab={tab} customer={customer} query={query} editable={editable} canDelete={can("customers.delete")} />
    </div>
  );
}

async function TabBody({
  tab,
  customer,
  query,
  editable,
  canDelete,
}: {
  tab: CustomerTab;
  customer: NonNullable<Awaited<ReturnType<typeof getCustomerDetail>>>;
  query: SearchParams;
  editable: boolean;
  canDelete: boolean;
}) {
  switch (tab) {
    case "overview":
      return <OverviewTab customer={customer} overview={await getCustomerOverview(customer.id)} />;
    case "profile":
      return <CustomerForm customer={customer} tagSuggestions={await getTagSuggestions()} canEdit={editable} />;
    case "addresses":
      return <AddressBook customerId={customer.id} addresses={await getCustomerAddresses(customer.id)} canEdit={editable} />;
    case "orders": {
      const result = await getCustomerOrders(customer.id, parseListParams(query, { pageSize: 25 }));
      return <OrdersTab rows={result.rows} meta={result.meta} />;
    }
    case "wishlist":
      return <WishlistTab rows={await getCustomerWishlist(customer.id)} />;
    case "reviews":
      return <ReviewsTab rows={await getCustomerReviews(customer.id)} customerId={customer.id} />;
    case "returns":
      return <ReturnsTab rows={await getCustomerReturns(customer.id)} />;
    case "refunds":
      return <RefundsTab rows={await getCustomerRefunds(customer.id)} />;
    case "payments":
      return <PaymentsTab rows={await getCustomerPayments(customer.id)} />;
    case "activity":
      return <ActivityTab activity={await getCustomerActivity(customer.id)} lastLoginAt={customer.lastLoginAt} />;
    case "danger":
      return <DangerZone customer={customer} canDelete={canDelete} />;
  }
}
