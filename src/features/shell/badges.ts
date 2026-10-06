import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/guards";
import { OPEN_RETURN_STATUSES } from "@/lib/enums";
import { hasPermission } from "@/lib/permissions";
import type { NavBadge, NavBadgeCounts } from "@/config/nav";
import { unreadCount } from "@/features/notifications/service";

/** The slice of the Actor this module needs; type-only so no Next import. */
export type BadgeActor = Pick<Actor, "id" | "permissions" | "isSuperAdmin">;

/**
 * Sidebar badge counts (blueprint §2 "badges are computed in the shell layout
 * in one query batch").
 *
 * Each badge is bound to the permission of the module it decorates, and a
 * count is only queried when the actor holds that permission (D14). That is
 * both the cheap thing - a content manager never pays for an order count - and
 * the correct thing: a badge on a hidden item would leak the size of a queue
 * the actor may not look at.
 *
 * The statuses counted are the "needs a human" states of each module; the
 * literal values are the vocabularies in src/lib/enums.ts.
 */

export const NAV_BADGE_PERMISSIONS: Record<NavBadge, string | null> = {
  pendingOrders: "orders.view",
  pendingSellers: "sellers.view",
  pendingReviews: "reviews.view",
  newInquiries: "inquiries.view",
  unreadNotifications: null,
  lowStock: "inventory.view",
  openReturns: "returns.view",
};

const COUNTERS: Record<NavBadge, (actor: BadgeActor) => Promise<number>> = {
  pendingOrders: () => db.order.count({ where: { status: "PENDING" } }),
  pendingSellers: () =>
    db.seller.count({
      where: { status: { in: ["PENDING", "UNDER_REVIEW"] }, deletedAt: null },
    }),
  pendingReviews: () => db.review.count({ where: { status: "PENDING" } }),
  newInquiries: () => db.contactInquiry.count({ where: { status: "NEW" } }),
  unreadNotifications: (actor) => unreadCount(actor.id),
  lowStock: () =>
    db.inventoryItem.count({
      where: { stockState: { in: ["LOW_STOCK", "OUT_OF_STOCK"] } },
    }),
  openReturns: () =>
    db.returnRequest.count({ where: { status: { in: [...OPEN_RETURN_STATUSES] } } }),
};

/** Badge keys the actor is entitled to see. */
export function visibleBadgeKeys(actor: BadgeActor): NavBadge[] {
  return (Object.keys(NAV_BADGE_PERMISSIONS) as NavBadge[]).filter((key) => {
    const permission = NAV_BADGE_PERMISSIONS[key];
    return (
      permission === null || actor.isSuperAdmin || hasPermission(actor.permissions, permission)
    );
  });
}

/**
 * All counts the actor may see, in one Promise.all. A failing counter yields
 * no badge rather than a failed layout - a badge is decoration, the page is
 * the work.
 */
export async function loadNavBadges(actor: BadgeActor): Promise<NavBadgeCounts> {
  const keys = visibleBadgeKeys(actor);
  const values = await Promise.all(
    keys.map((key) =>
      COUNTERS[key](actor).catch((error: unknown) => {
        console.error("NAV BADGE FAILED", key, error);
        return 0;
      }),
    ),
  );

  const counts: NavBadgeCounts = {};
  keys.forEach((key, index) => {
    if (values[index] > 0) counts[key] = values[index];
  });
  return counts;
}
