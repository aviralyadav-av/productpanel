import { apiOk, withAdminApi } from "@/lib/api/admin";

import { revealBankAccount } from "@/features/sellers/service";

/**
 * POST /api/admin/sellers/:id/bank-accounts/:bid/reveal   (payouts.process)
 *
 * The ONLY endpoint that decrypts a stored secret (D4). Audited as
 * `seller.bank_reveal` inside the same transaction; rate-limited per actor
 * because a reveal is something an operator does a few times a day, not a
 * few hundred times a minute.
 */
export const POST = withAdminApi<{ id: string; bid: string }>(
  async ({ req, params, actor, ip }) =>
    apiOk(await revealBankAccount(params.id, params.bid, actor, { ip, userAgent: req.headers.get("user-agent") })),
  { permission: "payouts.process", rateLimit: { limit: 30, windowMs: 60 * 60_000 } },
);
