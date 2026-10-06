import type { Prisma } from "@prisma/client";

import { asObject } from "@/lib/json";
import { scheduleState, sectionDefinition, type HomeResolver } from "@/features/content/registry";
import { HOME_RESOLVERS } from "@/features/storefront/home-resolvers";

import type { SectionPreviewData } from "./schemas";

/**
 * "What will the website receive for THIS section?" - one section through the
 * same resolver `/api/v1/home` uses (blueprint §14.E1), regardless of whether
 * the section is live, scheduled or disabled. Public `getHome` filters to the
 * live window and resolves the whole page; the editor needs the opposite: one
 * section, any state, and the error instead of a silent `items: []` when the
 * payload is broken.
 *
 * Plain module (no `server-only`, no `next/*`) so the check script can run it
 * under tsx.
 */

type SectionRow = {
  id: string;
  key: string;
  type: string;
  title: string;
  subtitle: string | null;
  enabled: boolean;
  publishAt: Date | null;
  unpublishAt: Date | null;
  payload: unknown;
  linkType: string;
  linkUrl: string | null;
  linkTargetId: string | null;
  buttonText: string | null;
  imageMediaId: string | null;
};

/** The payload as the resolver sees it: registry defaults filled in, invalid values dropped. */
export function effectiveSettings(type: string, payload: unknown): Record<string, unknown> {
  const definition = sectionDefinition(type);
  const raw = asObject<Record<string, unknown>>(payload, {});
  const parsed = definition.sectionSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const defaults = definition.sectionSchema.safeParse({});
  return defaults.success ? defaults.data : raw;
}

export async function previewSection(
  row: SectionRow,
  options: { now?: Date; tx?: Prisma.TransactionClient } = {},
): Promise<SectionPreviewData> {
  const now = options.now ?? new Date();
  const definition = sectionDefinition(row.type);
  const section: Parameters<HomeResolver>[0] = {
    id: row.id,
    key: row.key,
    type: row.type,
    title: row.title,
    subtitle: row.subtitle,
    payload: asObject<Record<string, unknown>>(row.payload, {}),
    linkType: row.linkType,
    linkUrl: row.linkUrl,
    linkTargetId: row.linkTargetId,
    buttonText: row.buttonText,
    imageMediaId: row.imageMediaId,
  };

  let items: unknown[] = [];
  let error: string | null = null;
  try {
    items = await HOME_RESOLVERS[definition.resolver](section, { now, tx: options.tx });
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }

  return {
    id: row.id,
    key: row.key,
    type: row.type,
    title: row.title,
    state: scheduleState(row, now),
    resolver: definition.resolver,
    settings: effectiveSettings(row.type, row.payload),
    items,
    error,
  };
}
