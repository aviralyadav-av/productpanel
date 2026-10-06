import { apiOk, withAdminApi } from "@/lib/api/admin";

import { runMarkEarningsAvailable } from "@/features/finance/payout-service";

/**
 * POST /api/admin/payouts/mark-available   (payouts.process)
 *
 * Runs the `earnings.mark_available` job now: PENDING → AVAILABLE for every
 * entry whose hold has passed and whose line has no open return. The scheduled
 * job does the same thing; this is for the operator who has just closed a
 * return and wants the money released without waiting for the next tick.
 */
export const POST = withAdminApi(
  async ({ actor, ip }) => apiOk(await runMarkEarningsAvailable(actor, { ip })),
  { permission: "payouts.process", rateLimit: { limit: 10, windowMs: 60_000 } },
);
