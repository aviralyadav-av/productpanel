import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { updateSubscriberSchema } from "@/features/newsletter/schemas";
import { deleteSubscriber, updateSubscriber } from "@/features/newsletter/service";

/**
 * PUT    /api/admin/newsletter/:id { name?, source?, status? }  (newsletter.manage)
 * DELETE /api/admin/newsletter/:id                              (newsletter.manage) - hard delete
 */
const patchSchema = updateSubscriberSchema.shape.patch;

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const patch = await parseJsonBody(req, patchSchema);
    const row = await updateSubscriber(params.id, patch, actor, { ip });
    return apiOk({ id: row.id, email: row.email, name: row.name, status: row.status, source: row.source, unsubscribedAt: row.unsubscribedAt });
  },
  { permission: "newsletter.manage" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ params, actor, ip }) => {
    await deleteSubscriber(params.id, actor, { ip });
    return apiNoContent();
  },
  { permission: "newsletter.manage" },
);
