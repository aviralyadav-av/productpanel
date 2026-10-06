import { apiCreated, apiList, parseJsonBody, parseListQuery, withAdminApi } from "@/lib/api/admin";

import { listUsers, userStatusCounts } from "@/features/users/queries";
import {
  USER_SORTS,
  inviteUserSchema,
  parseUserFilters,
  resolveUserSort,
} from "@/features/users/schemas";
import { inviteUser } from "@/features/users/service";

/**
 * GET  /api/admin/users?status=active|inactive|deleted&role=&twofa=1|0&q=&sort=&order=&page=
 *      (users.view) -> { data: UserListRow[], meta } + X-Status-Counts.
 * POST /api/admin/users { name, email, roleId, phone? }   (users.create)
 *      -> 201 { id, email, expiresAt, emailQueued }. There is no password
 *      field: D3 forbids an admin setting another admin's password, so the
 *      account is created unusable and the invite email carries the only way in.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, {
      defaultSort: "name",
      defaultOrder: "asc",
      allowedSorts: USER_SORTS,
    });
    const filters = parseUserFilters(query.raw);
    const [result, counts] = await Promise.all([
      listUsers({ ...query, sort: resolveUserSort(query.sort) }, filters),
      userStatusCounts(filters),
    ]);
    const response = apiList(result.rows, result.meta);
    response.headers.set("X-Status-Counts", JSON.stringify(counts));
    return response;
  },
  { permission: "users.view" },
);

export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const body = await parseJsonBody(req, inviteUserSchema);
    return apiCreated(await inviteUser(body, actor, { ip }));
  },
  { permission: "users.create" },
);
