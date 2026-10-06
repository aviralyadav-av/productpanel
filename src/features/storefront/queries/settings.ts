import { db } from "@/lib/db";
import { getPublicSettings } from "@/lib/settings";
import { publicMediaUrl } from "@/lib/serializers/public";

/**
 * `/api/v1/settings`: exactly the `isPublic` settings (secrets excluded
 * regardless of the flag - D11), via the shared settings reader.
 *
 * The seeded public keys `store.logo_media_id`, `store.favicon_media_id` and
 * `seo.og_image_media_id` are MediaAsset ids the website cannot use directly,
 * so each one gains a `<prefix>_url` sibling (e.g. `store.logo_url`) resolved
 * to an absolute media URL; the id keys stay for parity with the admin.
 *
 * NOTE: `@/lib/settings` imports `server-only`. Route files may import this
 * module freely; a plain tsx process must preload __checks__/stub-server-only.ts
 * (the denylist check does).
 */

const MEDIA_ID_SUFFIX = "_media_id";

export type PublicSettingsPayload = Record<string, unknown>;

export async function getPublicSettingsPayload(): Promise<PublicSettingsPayload> {
  const settings = await getPublicSettings();
  const payload: PublicSettingsPayload = { ...settings };

  const mediaKeys = Object.keys(settings).filter(
    (key) => key.endsWith(MEDIA_ID_SUFFIX) && typeof settings[key] === "string" && (settings[key] as string).trim() !== "",
  );
  if (mediaKeys.length > 0) {
    const ids = [...new Set(mediaKeys.map((key) => (settings[key] as string).trim()))];
    const assets = await db.mediaAsset.findMany({
      where: { id: { in: ids }, visibility: "PUBLIC" },
      select: { id: true, url: true },
    });
    const urlById = new Map(assets.map((asset) => [asset.id, publicMediaUrl(asset.url)]));
    for (const key of mediaKeys) {
      payload[`${key.slice(0, -MEDIA_ID_SUFFIX.length)}_url`] = urlById.get((settings[key] as string).trim()) ?? null;
    }
  }
  return payload;
}
