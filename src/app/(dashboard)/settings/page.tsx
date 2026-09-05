import type { Metadata } from "next";
import Link from "next/link";
import { UserX } from "lucide-react";
import { cn } from "cn";

import { requireAdmin } from "@/lib/auth/guards";
import { one, type SearchParams } from "@/lib/list-params";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import {
  LOGIN_LOCKOUT_ATTEMPTS,
  LOGIN_LOCKOUT_WINDOW_MINUTES,
  getAccountOverview,
  getActivityFacets,
  getActivityLog,
  getSettingGroups,
} from "@/features/settings/queries";
import { AccountTab } from "@/features/settings/components/account-tab";
import { ActivityTab } from "@/features/settings/components/activity-tab";
import { CutoverTab } from "@/features/settings/components/cutover-tab";
import { StoreTab } from "@/features/settings/components/store-tab";

export const metadata: Metadata = { title: "Settings" };

/**
 * One route, four tabs, driven by ?tab=. The dashboard panel and the sidebar
 * footer link straight to ?tab=activity and ?tab=cutover, so these keys are
 * part of the app's public surface - renaming one breaks those links.
 */
const TABS = [
  {
    value: "store",
    label: "Store",
    description:
      "The typed key/value registry behind the panel: store details, shipping, inventory, alerts, SEO and social.",
  },
  {
    value: "account",
    label: "Account",
    description:
      "Your own profile, password and sign-in history. Admin accounts are listed read-only.",
  },
  {
    value: "activity",
    label: "Activity log",
    description:
      "Every change any admin has made, newest first, with the fields that changed.",
  },
  {
    value: "cutover",
    label: "Cutover",
    description:
      "What still stands between this panel and the live storefront, checked against the storefront source.",
  },
] as const;

type SettingsTab = (typeof TABS)[number]["value"];

function resolveTab(raw: string | undefined): SettingsTab {
  const match = TABS.find((tab) => tab.value === raw);
  return match?.value ?? "store";
}

export default async function SettingsPage({
  searchParams,
}: PageProps<"/settings">) {
  const actor = await requireAdmin();
  const params = (await searchParams) as SearchParams;
  const tab = resolveTab(one(params, "tab"));

  let content: React.ReactNode;

  if (tab === "store") {
    content = <StoreTab groups={await getSettingGroups()} />;
  } else if (tab === "account") {
    const overview = await getAccountOverview(actor.id);
    content = overview ? (
      <AccountTab
        overview={overview}
        lockout={{
          attempts: LOGIN_LOCKOUT_ATTEMPTS,
          windowMinutes: LOGIN_LOCKOUT_WINDOW_MINUTES,
        }}
      />
    ) : (
      <div className="surface">
        <EmptyState
          icon={UserX}
          title="Your account row could not be read"
          description="You are signed in, but the user record behind this session is missing. Sign out and back in."
        />
      </div>
    );
  } else if (tab === "activity") {
    const [log, facets] = await Promise.all([
      getActivityLog(params),
      getActivityFacets(),
    ]);
    content = (
      <ActivityTab
        rows={log.rows}
        meta={log.meta}
        filters={log.filters}
        isFiltered={log.isFiltered}
        facets={facets}
      />
    );
  } else {
    content = <CutoverTab />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        description={TABS.find((entry) => entry.value === tab)?.description}
      >
        <TabStrip active={tab} />
      </PageHeader>

      {content}
    </div>
  );
}

function TabStrip({ active }: { active: SettingsTab }) {
  return (
    <div
      role="tablist"
      aria-label="Settings sections"
      className="bg-muted inline-flex w-fit items-center gap-0.5 rounded-lg p-0.5"
    >
      {TABS.map((tab) => {
        const isActive = tab.value === active;
        return (
          <Link
            // Bare hrefs on purpose: switching tabs drops the activity log's
            // search, filters and page number rather than carrying them into a
            // tab where they mean nothing.
            key={tab.value}
            href={`/settings?tab=${tab.value}` as never}
            role="tab"
            aria-selected={isActive}
            scroll={false}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
              isActive
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
