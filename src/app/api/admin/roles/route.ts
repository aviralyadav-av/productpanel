import { apiCreated, apiList, parseJsonBody, parseListQuery, withAdminApi } from "@/lib/api/admin";

import { listRoles } from "@/features/roles/queries";
import { ROLE_SORTS, parseRoleFilters, resolveRoleSort, roleFormSchema } from "@/features/roles/schemas";
import { createRole } from "@/features/roles/service";

/**
 * GET  /api/admin/roles?q=&system=1|0&sort=&order=&page=   (roles.view)
 * POST /api/admin/roles { name, slug?, description?, permissions[] }  (roles.manage)
 *
 * The subset rule (D3) is enforced in the service, so this handler stays a
 * parse-and-delegate: an actor cannot create a role granting more than they
 * hold, whichever door they come through.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, {
      defaultSort: "name",
      defaultOrder: "asc",
      allowedSorts: ROLE_SORTS,
      pageSize: 50,
    });
    const result = await listRoles(
      { ...query, sort: resolveRoleSort(query.sort) },
      parseRoleFilters(query.raw),
    );
    return apiList(result.rows, result.meta);
  },
  { permission: "roles.view" },
);

export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const body = await parseJsonBody(req, roleFormSchema);
    const role = await createRole(body, actor, { ip });
    return apiCreated(role);
  },
  { permission: "roles.manage" },
);
