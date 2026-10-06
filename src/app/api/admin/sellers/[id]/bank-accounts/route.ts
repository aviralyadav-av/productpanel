import { apiCreated, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { listSellerBankAccounts } from "@/features/sellers/detail-queries";
import { bankAccountSchema } from "@/features/sellers/schemas";
import { addBankAccount } from "@/features/sellers/service";

/**
 * GET  /api/admin/sellers/:id/bank-accounts                         masked list (last4 only)   (sellers.view)
 * POST /api/admin/sellers/:id/bank-accounts { accountHolder, bankName, accountNumber, ifsc, upiId?, isPrimary? }   (sellers.edit)
 *
 * The number is encrypted with the `bank` purpose before it is stored (D4);
 * responses never include it.
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => apiOk(await listSellerBankAccounts(params.id)),
  { permission: "sellers.view" },
);

export const POST = withAdminApi<{ id: string }>(
  async ({ req, params, actor }) => {
    const input = await parseJsonBody(req, bankAccountSchema);
    const result = await addBankAccount(params.id, input, actor);
    return apiCreated({ account: result.account, autoActivated: result.autoActivated });
  },
  { permission: "sellers.edit" },
);
