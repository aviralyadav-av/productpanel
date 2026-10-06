import { z } from "zod";

import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { bulkAdjustStockForActor, bulkSetThresholdForActor } from "@/features/inventory/mutations";
import { bulkAdjustStockSchema, bulkSetThresholdSchema } from "@/features/inventory/schemas";

/**
 * POST /api/admin/inventory/bulk   (inventory.adjust)
 *
 *   { op: "adjust",    variantIds[], mode, quantity, type, reason?, note? }
 *   { op: "threshold", variantIds[], lowStockThreshold, allowBackorder? }
 *
 * ≤ 500 ids, one transaction, all-or-nothing, summary result (§11.33).
 */
const bodySchema = z.discriminatedUnion("op", [
  bulkAdjustStockSchema.safeExtend({ op: z.literal("adjust") }),
  bulkSetThresholdSchema.extend({ op: z.literal("threshold") }),
]);

export const POST = withAdminApi(
  async ({ req, actor }) => {
    const body = await parseJsonBody(req, bodySchema);
    if (body.op === "threshold") {
      const { op: _op, ...values } = body;
      void _op;
      return apiOk(await bulkSetThresholdForActor(actor, values));
    }
    const { op: _op, ...values } = body;
    void _op;
    return apiOk(await bulkAdjustStockForActor(actor, values));
  },
  { permission: "inventory.adjust", rateLimit: { limit: 30, windowMs: 60_000 } },
);
