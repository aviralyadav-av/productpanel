import type { Metadata } from "next";
import { forbidden } from "next/navigation";

import { can, requirePermission } from "@/lib/auth/guards";
import type { SearchParams } from "@/lib/list-params";
import type { SettingGroup } from "@/lib/settings-keys";
import { PageHeader } from "@/components/shared/page-header";

import { PaymentsTab } from "@/features/settings/components/payments-tab";
import { SecuritySummaryPanel } from "@/features/settings/components/security-summary";
import { SettingsForm } from "@/features/settings/components/settings-form";
import { SettingsNav } from "@/features/settings/components/settings-nav";
import {
  getSecuritySummary,
  getSettingsGroup,
  getSettingValues,
  listProviderViews,
} from "@/features/settings/queries";
import {
  PAYMENTS_TAB,
  SETTINGS_TABS,
  TAB_DESCRIPTIONS,
  TAB_LABELS,
  parseSettingsTab,
  tabPermission,
} from "@/features/settings/schemas";

export const metadata: Metadata = { title: "Settings" };

/**
 * /admin/settings?tab=<group> (blueprint §14.E2, D14).
 *
 * One route, one tab per setting group plus Payments, every form generated
 * from the registry in src/lib/settings-keys.ts. Two tabs need more than
 * `settings.manage`: Payments and Security are super-admin-only codes (D14),
 * so they are hidden from the strip and refused on direct navigation rather
 * than rendered read-only - showing an operator masked gateway credentials
 * they may not touch is a leak, not a courtesy.
 */
export default async function SettingsPage({ searchParams }: PageProps<"/admin/settings">) {
  const actor = await requirePermission("settings.view");

  const params = (await searchParams) as SearchParams;
  const tab = parseSettingsTab(params);

  const visibleTabs = SETTINGS_TABS.filter(
    (item) =>
      (item !== PAYMENTS_TAB || can(actor, "settings.manage_payments")) &&
      (item !== "security" || can(actor, "settings.manage_security")),
  );
  if (!visibleTabs.includes(tab)) forbidden();

  const canEdit = can(actor, tabPermission(tab));

  const header = (
    <PageHeader
      title="Settings"
      description={TAB_DESCRIPTIONS[tab]}
    />
  );

  if (tab === PAYMENTS_TAB) {
    const providers = await listProviderViews();
    return (
      <div className="space-y-4">
        {header}
        <SettingsNav tabs={visibleTabs} active={tab} />
        <PaymentsTab providers={providers} canEdit={canEdit} />
      </div>
    );
  }

  const group = tab as SettingGroup;
  const [view, storefront, security] = await Promise.all([
    getSettingsGroup(group),
    group === "general" ? getSettingValues(["storefront.base_url"]) : Promise.resolve(null),
    group === "security" ? getSecuritySummary() : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-4">
      {header}
      <SettingsNav tabs={visibleTabs} active={tab} />
      <SettingsForm
        key={`${group}-${TAB_LABELS[tab]}`}
        group={view}
        canEdit={canEdit}
        storefrontUrl={storefront?.["storefront.base_url"] || null}
      />
      {security ? <SecuritySummaryPanel summary={security} /> : null}
    </div>
  );
}
