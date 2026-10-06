import { z } from "zod";

import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { forbiddenError, notFound } from "@/lib/api/errors";
import { can } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import type { SellerStatus } from "@/lib/enums";

import { permissionForTransition, transitionSellerBodySchema } from "@/features/sellers/schemas";
import { transitionSeller } from "@/features/sellers/service";

/**
 * PUT /api/admin/sellers/:id/status { toStatus, reason?, activate? }   (C5)
 *
 * The permission depends on the edge: suspend/reinstate need sellers.suspend,
 * review/approve/reject/activate need sellers.approve. Illegal edges are 409,
 * a missing reason on REJECTED/SUSPENDED is 422.
 */
const bodySchema = transitionSellerBodySchema;

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor }) => {
    const body = await parseJsonBody(req, bodySchema);
    const current = await db.seller.findUnique({ where: { id: params.id }, select: { status: true, deletedAt: true } });
    if (!current || current.deletedAt) throw notFound("Seller");

    const needed = permissionForTransition(current.status as SellerStatus, body.toStatus);
    if (!can(actor, needed)) throw forbiddenError(`This transition requires ${needed}.`);

    const result = await transitionSeller({
      sellerId: params.id,
      toStatus: body.toStatus,
      actor,
      reason: body.reason,
      activate: body.activate,
    });
    return apiOk({
      id: result.seller.id,
      fromStatus: result.fromStatus,
      status: result.seller.status,
      path: result.path,
      activationSkipped: result.activationSkipped,
    });
  },
  { permission: ["sellers.approve", "sellers.suspend"] },
);

export type StatusBody = z.infer<typeof bodySchema>;
