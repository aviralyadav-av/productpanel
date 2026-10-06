import Link from "next/link";
import type { Route } from "next";
import { ExternalLink } from "lucide-react";
import { cn } from "cn";

import { SELLER_STATUS_META, type SellerStatus } from "@/lib/enums";
import { formatIstDate } from "@/lib/dates";
import { Stepper, type StepperStep } from "@/components/shared/stepper";

import { SellerStatusBadge } from "@/features/sellers/components/badges";
import { SellerAvatar } from "@/features/sellers/components/seller-avatar";
import { SellerHeaderActions } from "@/features/sellers/components/seller-header-actions";
import { SELLER_TABS, SELLER_TAB_LABELS, type SellerTab } from "@/features/sellers/schemas";
import type { SellerDetail } from "@/features/sellers/types";

/**
 * Header, C5 workflow stepper and tab strip of the seller detail page. Server
 * Components: the only interactive piece is the actions strip.
 */

export function SellerHeader({ seller }: { seller: SellerDetail }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <SellerAvatar name={seller.displayName} src={seller.logo?.thumbnailUrl ?? seller.logo?.url ?? null} size={48} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight">{seller.displayName}</h1>
            <SellerStatusBadge status={seller.status} />
          </div>
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
            <a href={seller.publicUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono hover:underline">
              {seller.publicUrl.replace(/^https?:\/\//, "")}
              <ExternalLink className="size-3" />
            </a>
            <span aria-hidden>·</span>
            <span>Member since {formatIstDate(new Date(seller.createdAt))}</span>
            {seller.legalName ? (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{seller.legalName}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>
      <SellerHeaderActions seller={seller} />
    </div>
  );
}

/**
 * The happy path is PENDING → UNDER_REVIEW → APPROVED → ACTIVE. SUSPENDED and
 * REJECTED are side exits, shown as an error state on the step they left.
 */
export function SellerWorkflowStepper({ seller }: { seller: SellerDetail }) {
  const flow: SellerStatus[] = ["PENDING", "UNDER_REVIEW", "APPROVED", "ACTIVE"];
  const status = seller.status;
  let currentIndex = flow.indexOf(status);
  const steps: StepperStep[] = flow.map((step) => ({
    id: step,
    label: SELLER_STATUS_META[step].label,
    description:
      step === "APPROVED"
        ? seller.activation.ready
          ? "KYC + bank ready"
          : `${seller.activation.verifiedDocuments} verified doc${seller.activation.verifiedDocuments === 1 ? "" : "s"}, ${
              seller.activation.hasPrimaryBank ? "bank on file" : "no primary bank"
            }`
        : undefined,
  }));

  if (status === "REJECTED") {
    currentIndex = 1;
    steps[1] = { ...steps[1], label: "Rejected", status: "error", description: seller.rejectionReason ?? undefined };
  } else if (status === "SUSPENDED") {
    currentIndex = 3;
    steps[3] = { ...steps[3], label: "Suspended", status: "error", description: seller.suspensionReason ?? undefined };
  } else if (status === "ACTIVE") {
    currentIndex = 4; // every step complete
  }

  return (
    <div className="surface px-4 py-3">
      <Stepper steps={steps} currentIndex={currentIndex} />
    </div>
  );
}

export function SellerTabNav({ sellerId, active, counts }: { sellerId: string; active: SellerTab; counts?: Partial<Record<SellerTab, number>> }) {
  return (
    <nav aria-label="Seller sections" className="-mx-1 overflow-x-auto">
      <div role="tablist" className="bg-muted inline-flex min-w-full items-center gap-0.5 rounded-lg p-0.5 sm:min-w-0">
        {SELLER_TABS.map((tab) => {
          const isActive = tab === active;
          const count = counts?.[tab];
          return (
            <Link
              key={tab}
              role="tab"
              aria-selected={isActive}
              href={`/admin/sellers/${sellerId}${tab === "overview" ? "" : `?tab=${tab}`}` as Route}
              scroll={false}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                isActive ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {SELLER_TAB_LABELS[tab]}
              {typeof count === "number" && count > 0 ? (
                <span data-numeric className="text-muted-foreground/80 text-[10px]">
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
