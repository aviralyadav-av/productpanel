import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "cn";

import { PartnersTab } from "@/features/shipping/components/partners-tab";
import { PincodesTab } from "@/features/shipping/components/pincodes-tab";
import { RatesTab } from "@/features/shipping/components/rates-tab";
import { ZonesTab } from "@/features/shipping/components/zones-tab";
import { getPincodeStats, listPartners, listPincodes, listRates, listZoneOptions, listZones } from "@/features/shipping/queries";
import { PINCODE_SORTS, parsePincodeListFilters, parseRateZoneFilter, resolveShippingTab, type ShippingTab } from "@/features/shipping/schemas";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { can, requirePermission } from "@/lib/auth/guards";
import { one, parseListParams, type SearchParams } from "@/lib/list-params";
import { formatNumber } from "@/lib/money";

export const metadata: Metadata = { title: "Shipping" };

/**
 * One route, four tabs driven by ?tab= (blueprint §6). Each tab loads only
 * its own data; the zones list is shared because rates, pincodes and the
 * import dialog all need the zone names.
 */
const TABS: ReadonlyArray<{ value: ShippingTab; label: string; description: string }> = [
  { value: "zones", label: "Zones", description: "Where you ship. A pincode resolves to its assigned zone, else the longest matching prefix, else its state, else the default zone." },
  { value: "rates", label: "Rates", description: "What each zone charges per method, with weight and order-value bounds, free-shipping thresholds and COD rules." },
  { value: "pincodes", label: "Pincodes", description: "Per-pincode overrides: serviceability, COD, delivery estimate and a pinned zone. Import a courier's CSV or edit rows by hand." },
  { value: "partners", label: "Partners", description: "Couriers you hand shipments to, with the tracking URL template that turns a tracking number into a link." },
];

export default async function ShippingPage({ searchParams }: PageProps<"/admin/shipping">) {
  const actor = await requirePermission("shipping.view");
  const params = (await searchParams) as SearchParams;
  const tab = resolveShippingTab(one(params, "tab"));
  const canManage = can(actor, "shipping.manage");

  let content: React.ReactNode;
  let kpis: React.ReactNode = null;

  if (tab === "zones") {
    content = <ZonesTab zones={await listZones()} canManage={canManage} />;
  } else if (tab === "rates") {
    const zoneFilter = parseRateZoneFilter(params);
    const [rates, zones] = await Promise.all([listRates({ zoneId: zoneFilter }), listZoneOptions()]);
    content = <RatesTab rates={rates} zones={zones} zoneFilter={zoneFilter} canManage={canManage} />;
  } else if (tab === "pincodes") {
    const listParams = parseListParams(params, { defaultSort: "pincode", defaultOrder: "asc", pageSize: 50 });
    if (!(PINCODE_SORTS as readonly string[]).includes(listParams.sort)) listParams.sort = "pincode";
    const filters = parsePincodeListFilters(params);
    const [result, zones, stats] = await Promise.all([listPincodes(listParams, filters), listZoneOptions(), getPincodeStats()]);
    kpis = (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pincode rows" value={formatNumber(stats.total)} hint="Explicit overrides; everything else follows zone rules" />
        <StatCard label="Serviceable" value={formatNumber(stats.serviceable)} hint="Rows switched on" href={"/admin/shipping?tab=pincodes&serviceable=yes" as Route} />
        <StatCard label="Not serviceable" value={formatNumber(stats.nonServiceable)} hint="Excluded pincodes" href={"/admin/shipping?tab=pincodes&serviceable=no" as Route} higherIsBetter={false} />
        <StatCard label="COD enabled" value={formatNumber(stats.codEnabled)} hint="Serviceable rows that allow cash on delivery" href={"/admin/shipping?tab=pincodes&cod=yes" as Route} />
      </div>
    );
    content = <PincodesTab rows={result.rows} meta={result.meta} zones={zones} sort={listParams.sort} order={listParams.order} canManage={canManage} />;
  } else {
    content = <PartnersTab partners={await listPartners()} canManage={canManage} />;
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Shipping" description={TABS.find((entry) => entry.value === tab)?.description}>
        <TabStrip active={tab} />
      </PageHeader>
      {kpis}
      {content}
    </div>
  );
}

function TabStrip({ active }: { active: ShippingTab }) {
  return (
    <div role="tablist" aria-label="Shipping sections" className="bg-muted inline-flex w-fit items-center gap-0.5 rounded-lg p-0.5">
      {TABS.map((tab) => {
        const isActive = tab.value === active;
        return (
          <Link
            // Bare hrefs on purpose: switching tabs drops the pincode list's
            // search, filters and page rather than carrying them somewhere
            // they mean nothing.
            key={tab.value}
            href={`/admin/shipping?tab=${tab.value}` as Route}
            role="tab"
            aria-selected={isActive}
            scroll={false}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
              isActive ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
