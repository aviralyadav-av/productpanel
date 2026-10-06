import { apiOk, parseListQuery, withAdminApi } from "@/lib/api/admin";

import { getMediaAssets, listMedia } from "@/features/media/queries";
import { MEDIA_SORTS, parseMediaListFilters } from "@/features/media/schemas";

/**
 * GET /api/admin/media?page&pageSize&sort&order&q&kind&folder&visibility&from&to   (media.view)
 *
 * `{ data: MediaAssetDto[], meta, counts: { all, image, video, document } }`.
 * `folder=root` means unfiled, `folder=<id>` one folder, absent = everywhere.
 *
 * GET /api/admin/media?id=a&id=b   returns exactly those assets, in that order
 * (`{ data }`), for editors re-hydrating a saved selection into PickedAssets.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const ids = searchParams.getAll("id").filter(Boolean);
    if (ids.length > 0) {
      return apiOk(await getMediaAssets(ids.slice(0, 100)));
    }

    const query = parseListQuery(searchParams, {
      defaultSort: "createdAt",
      defaultOrder: "desc",
      allowedSorts: MEDIA_SORTS,
      pageSize: 40,
    });
    const filters = parseMediaListFilters(searchParams);
    const result = await listMedia(query, { ...filters, q: filters.q || query.q || undefined });

    return Response.json(
      { data: result.rows, meta: result.meta, counts: result.counts },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
  { permission: "media.view" },
);
