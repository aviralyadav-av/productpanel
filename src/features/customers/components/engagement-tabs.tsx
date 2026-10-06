import Link from "next/link";
import type { Route } from "next";
import { Activity, Heart, LogIn, MessageSquare, Star } from "lucide-react";

import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Panel } from "@/components/shared/panel";
import { PriceText } from "@/components/shared/price-text";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { ProductStatusBadge, ReviewStatusBadge, StatusPill } from "@/components/shared/status-badge";
import { StatusTimeline, type TimelineEvent } from "@/components/shared/status-timeline";
import { formatIstDate, formatIstDateTime } from "@/lib/dates";

import type { CustomerActivity, CustomerReviewRow, WishlistRow } from "@/features/customers/queries";

/**
 * Engagement tabs of the customer profile: wishlist (written by the website
 * through the integration API), reviews and the activity trail (audit rows,
 * mirrored website sessions, admin notifications about this customer).
 */

export function WishlistTab({ rows }: { rows: WishlistRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="surface">
        <EmptyState icon={Heart} title="Wishlist is empty" description="The website syncs the wishlist through PUT /api/v1/integration/customers/:email/wishlist; nothing has been sent for this customer yet." />
      </div>
    );
  }
  return (
    <div className="surface overflow-hidden">
      <ResponsiveTable
        table={
          <DataTable>
            <DataTableHead>
              <Th>Product</Th>
              <Th>Variant</Th>
              <Th>Availability</Th>
              <Th>Added</Th>
              <Th align="right">Price</Th>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <Link href={`/admin/products/${row.product.id}` as Route} className="font-medium hover:underline">
                      {row.product.title}
                    </Link>
                    <div className="text-muted-foreground font-mono text-[11px]">/{row.product.slug}</div>
                  </Td>
                  <Td className="text-xs">
                    {row.variant.name}
                    {row.variant.sku ? <span className="text-muted-foreground font-mono"> · {row.variant.sku}</span> : null}
                  </Td>
                  <Td>
                    <span className="flex items-center gap-1">
                      <ProductStatusBadge status={row.product.status} />
                      {!row.variant.isActive ? <StatusPill label="Variant inactive" tone="warning" /> : null}
                    </span>
                  </Td>
                  <Td className="text-muted-foreground text-xs whitespace-nowrap">{formatIstDate(row.createdAt)}</Td>
                  <Td align="right" numeric>
                    <PriceText paise={row.variant.pricePaise ?? row.product.pricePaise} />
                  </Td>
                </Tr>
              ))}
            </DataTableBody>
          </DataTable>
        }
        cards={rows.map((row) => (
          <MobileCard key={row.id} href={`/admin/products/${row.product.id}`} title={row.product.title} subtitle={row.variant.name} meta={<PriceText paise={row.variant.pricePaise ?? row.product.pricePaise} />}>
            <MobileCardField label="Added">{formatIstDate(row.createdAt)}</MobileCardField>
            <MobileCardField label="Status">
              <ProductStatusBadge status={row.product.status} />
            </MobileCardField>
          </MobileCard>
        ))}
      />
    </div>
  );
}

export function ReviewsTab({ rows, customerId }: { rows: CustomerReviewRow[]; customerId: string }) {
  if (rows.length === 0) {
    return (
      <div className="surface">
        <EmptyState icon={MessageSquare} title="No reviews" description="Reviews this customer submits on the website land here as PENDING until moderated." />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Link href={`/admin/reviews?customer=${customerId}` as Route} className="text-muted-foreground hover:text-foreground text-xs underline">
          Moderate in Reviews
        </Link>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {rows.map((review) => (
          <li key={review.id} className="surface space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {review.product ? (
                  <Link href={`/admin/products/${review.product.id}` as Route} className="truncate text-sm font-medium hover:underline">
                    {review.product.title}
                  </Link>
                ) : (
                  <p className="text-muted-foreground text-sm italic">Product removed</p>
                )}
                <p className="text-muted-foreground text-[11px]">
                  {formatIstDate(review.createdAt)}
                  {review.isVerifiedPurchase ? " · Verified purchase" : ""}
                </p>
              </div>
              <ReviewStatusBadge status={review.status} />
            </div>
            {review.rating ? (
              <div className="flex items-center gap-0.5" aria-label={`${review.rating} out of 5`}>
                {Array.from({ length: 5 }).map((_, index) => (
                  <Star key={index} className={index < (review.rating ?? 0) ? "fill-warning text-warning size-3" : "text-muted-foreground/40 size-3"} />
                ))}
              </div>
            ) : null}
            {review.title ? <p className="text-sm font-medium">{review.title}</p> : null}
            <p className="text-muted-foreground line-clamp-4 text-xs leading-relaxed">{review.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ActivityTab({ activity, lastLoginAt }: { activity: CustomerActivity; lastLoginAt: Date | null }) {
  const events: TimelineEvent[] = [
    ...activity.audit.map<TimelineEvent>((row) => ({
      id: `audit-${row.id}`,
      title: row.summary,
      description: `${row.action}${row.ip ? ` · ${row.ip}` : ""}`,
      at: row.createdAt,
      actor: row.actorEmail,
      tone: row.action.includes("block") || row.action.includes("delete") ? "danger" : row.action.includes("password") ? "warning" : "neutral",
      icon: Activity,
      isInternal: true,
    })),
    ...activity.notifications.map<TimelineEvent>((row) => ({
      id: `notification-${row.id}`,
      title: row.title,
      description: row.body ?? row.type,
      at: row.createdAt,
      tone: "info",
    })),
  ];
  const liveSessions = activity.sessions.filter((session) => !session.revokedAt && session.expiresAt > new Date()).length;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title="Timeline" description="Audit rows and notifications about this customer" className="lg:col-span-2" bodyClassName="p-4">
        <StatusTimeline events={events} emptyText="Nothing recorded yet - changes made from the admin and website events show up here." />
      </Panel>
      <Panel title="Website sessions" description={lastLoginAt ? `Last login ${formatIstDateTime(lastLoginAt)} · ${liveSessions} live` : "Never logged in"}>
        {activity.sessions.length === 0 ? (
          <EmptyState compact icon={LogIn} title="No sessions" description="Login events sent by the website (POST …/login-event) are listed here." />
        ) : (
          <ul className="divide-y">
            {activity.sessions.map((session) => {
              const state = session.revokedAt ? "Revoked" : session.expiresAt < new Date() ? "Expired" : "Active";
              return (
                <li key={session.id} className="space-y-0.5 px-4 py-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{formatIstDateTime(session.createdAt)}</span>
                    <StatusPill label={state} tone={state === "Active" ? "success" : "neutral"} dot={false} />
                  </div>
                  <p className="text-muted-foreground truncate" title={session.userAgent ?? undefined}>
                    {session.ip ?? "IP unknown"}
                    {session.userAgent ? ` · ${session.userAgent}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
