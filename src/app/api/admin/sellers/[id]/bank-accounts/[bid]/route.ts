import { z } from "zod";

import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { forbiddenError } from "@/lib/api/errors";
import { can } from "@/lib/auth/guards";

import { bankAccountUpdateSchema } from "@/features/sellers/schemas";
import { deleteBankAccount, setPrimaryBankAccount, updateBankAccount, verifyBankAccount } from "@/features/sellers/service";

/**
 * PUT    /api/admin/sellers/:id/bank-accounts/:bid { ...details }             edit (blank accountNumber keeps it)   (sellers.edit)
 * PUT    /api/admin/sellers/:id/bank-accounts/:bid { action: "set_primary" }                                       (sellers.edit)
 * PUT    /api/admin/sellers/:id/bank-accounts/:bid { action: "verify" }                                            (sellers.approve)
 * DELETE /api/admin/sellers/:id/bank-accounts/:bid   409 while a payout statement references it                     (sellers.edit)
 */
const bodySchema = z.union([
  z.object({ action: z.enum(["set_primary", "verify"]) }),
  bankAccountUpdateSchema,
]);

export const PUT = withAdminApi<{ id: string; bid: string }>(
  async ({ req, params, actor }) => {
    const body = await parseJsonBody(req, bodySchema);
    if ("action" in body) {
      if (body.action === "verify") {
        if (!can(actor, "sellers.approve")) throw forbiddenError("Verifying a bank account requires sellers.approve.");
        return apiOk(await verifyBankAccount(params.id, params.bid, actor));
      }
      const result = await setPrimaryBankAccount(params.id, params.bid, actor);
      return apiOk({ ...result.account, autoActivated: result.autoActivated });
    }
    return apiOk(await updateBankAccount(params.id, params.bid, body, actor));
  },
  { permission: ["sellers.edit", "sellers.approve"] },
);

export const DELETE = withAdminApi<{ id: string; bid: string }>(
  async ({ params, actor }) => {
    await deleteBankAccount(params.id, params.bid, actor);
    return apiNoContent();
  },
  { permission: "sellers.edit" },
);
