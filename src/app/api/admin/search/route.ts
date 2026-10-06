import { apiOk, withAdminApi } from "@/lib/api/admin";
import { validationError, zodDetails } from "@/lib/api/errors";
import {
  parseScopesParam,
  searchAdmin,
  searchInputSchema,
} from "@/features/search/service";

/**
 * GET /api/admin/search?q=&scopes=product,order&limit=8
 * → 200 { data: { results: SearchHit[] } }
 *
 * Any signed-in admin may call it; the SERVICE intersects scopes with the
 * actor's `*.view` permissions (D14), so no `permission` option here. Rate
 * limited per actor because the ⌘K menu fires on every pause in typing.
 */
export const GET = withAdminApi(
  async ({ actor, searchParams }) => {
    const parsed = searchInputSchema.safeParse({
      q: searchParams.get("q") ?? "",
      scopes: parseScopesParam(searchParams.get("scopes")),
      limit: searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) throw validationError(zodDetails(parsed.error));

    return apiOk(await searchAdmin(actor, parsed.data));
  },
  { rateLimit: { limit: 120, windowMs: 60_000, keyBy: "actor" } },
);
