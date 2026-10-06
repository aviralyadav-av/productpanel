import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { forbiddenError } from "@/lib/api/errors";
import { can } from "@/lib/auth/guards";
import { SETTING_DEFINITIONS } from "@/lib/settings-keys";

import { getSettingsGroup } from "@/features/settings/queries";
import { tabPermission, updateSettingsSchema, type SettingsTab } from "@/features/settings/schemas";
import { updateSettings } from "@/features/settings/service";

/**
 * GET /api/admin/settings?group=<group>                    (settings.view)
 *     -> { data: { groups: SettingsGroupView[] } }; secrets are masked to
 *        { isSet, last4 } and never carry a value (D4).
 * PUT /api/admin/settings { values: { key: string } }      (settings.manage,
 *     plus settings.manage_security when a security.* key is included - D14)
 *     -> { data: { changedKeys, groups } }
 */
const GROUPS = [...new Set(SETTING_DEFINITIONS.map((item) => item.group))];
const GROUP_BY_KEY = new Map(SETTING_DEFINITIONS.map((item) => [item.key, item.group]));

export const GET = withAdminApi(
  async ({ searchParams }) => {
    const wanted = searchParams.get("group");
    const groups = wanted ? GROUPS.filter((group) => group === wanted) : GROUPS;
    const views = await Promise.all(groups.map((group) => getSettingsGroup(group)));
    return apiOk({ groups: views });
  },
  { permission: "settings.view" },
);

export const PUT = withAdminApi(
  async ({ req, actor, ip }) => {
    const body = await parseJsonBody(req, updateSettingsSchema);

    // The extra codes are derived from the KEYS, not from a tab name the
    // client sends: otherwise a security.* key smuggled into a store save
    // would bypass D14's super-admin-only permission.
    for (const key of Object.keys(body.values)) {
      const group = GROUP_BY_KEY.get(key);
      if (!group) continue;
      const code = tabPermission(group as SettingsTab);
      if (code !== "settings.manage" && !can(actor, code)) throw forbiddenError();
    }

    const result = await updateSettings(body.values, actor, { ip });
    return apiOk(result);
  },
  { permission: "settings.manage" },
);
