import { apiOk, withAdminApi } from "@/lib/api/admin";

import { permissionGroupViews } from "@/features/roles/queries";
import { grantableCodes } from "@/features/roles/subset";

/**
 * GET /api/admin/permissions  (roles.view)
 *
 * The permission registry folded into groups, plus the codes THIS actor may
 * grant - the matrix editor needs both to render, and computing "grantable"
 * on the server is what stops a client deciding it for itself (D3).
 */
export const GET = withAdminApi(
  async ({ actor }) =>
    apiOk({ groups: permissionGroupViews(), grantable: grantableCodes(actor) }),
  { permission: "roles.view" },
);
