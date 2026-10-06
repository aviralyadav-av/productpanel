import type { PrismaClient } from "@prisma/client";

import { SETTING_DEFINITIONS } from "../../../src/lib/settings-keys";
import type { SeedContext } from "./context";

/**
 * Every key in SETTING_DEFINITIONS (blueprint E2) with its default value.
 * Re-seeding refreshes the metadata (label, help text, group, type, isPublic)
 * but never the value: an operator's edits survive `db:seed`.
 */
export async function seedSettings(db: PrismaClient, ctx: SeedContext) {
  for (const definition of SETTING_DEFINITIONS) {
    await db.setting.upsert({
      where: { key: definition.key },
      update: {
        type: definition.type,
        group: definition.group,
        label: definition.label,
        helpText: definition.helpText || null,
        isPublic: definition.isPublic,
      },
      create: {
        key: definition.key,
        value: definition.defaultValue,
        type: definition.type,
        group: definition.group,
        label: definition.label,
        helpText: definition.helpText || null,
        isPublic: definition.isPublic,
      },
    });
  }
  ctx.log(`settings: ${SETTING_DEFINITIONS.length}`);
}
