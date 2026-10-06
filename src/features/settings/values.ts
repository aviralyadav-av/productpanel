/**
 * Pure setting-value rules (blueprint §14.E2, D4).
 *
 * Every Setting is stored as a STRING - the column is `String` - so this file
 * is the single place that says what a valid string looks like per `type` and
 * which of the submitted keys actually changed. Keeping it pure (no db, no
 * crypto, no next) means the service, the REST handler and a node:test all
 * agree on the same sentences, and the interesting rule - "an empty secret
 * means unchanged, not cleared" - is testable without a database.
 */
import type { SettingDefinition } from "@/lib/settings-keys";

export type ValueCheck =
  | { ok: true; value: string }
  | { ok: false; message: string };

/** The maximum length any single setting value may take (robots.txt is the big one). */
export const MAX_SETTING_LENGTH = 8_000;

/**
 * Validate and normalise one submitted value against its definition.
 *
 * Money and number both arrive as integer strings: the client's MoneyInput
 * submits paise, so there is exactly one rupees->paise conversion in the app
 * and it happens in the browser control, not here.
 */
export function checkSettingValue(definition: SettingDefinition, raw: string): ValueCheck {
  const value = definition.type === "json" ? raw.trim() : raw.trim();

  if (value.length > MAX_SETTING_LENGTH) {
    return { ok: false, message: `Keep this under ${MAX_SETTING_LENGTH} characters.` };
  }

  switch (definition.type) {
    case "boolean":
      if (value === "true" || value === "false") return { ok: true, value };
      return { ok: false, message: "Must be on or off." };

    case "number":
    case "money": {
      if (value === "") return { ok: false, message: "Enter a number." };
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return { ok: false, message: "Enter a number." };
      if (!Number.isInteger(parsed)) {
        return {
          ok: false,
          message: definition.type === "money" ? "Amounts are whole paise." : "Whole numbers only.",
        };
      }
      if (parsed < 0) return { ok: false, message: "Cannot be negative." };
      return { ok: true, value: String(parsed) };
    }

    case "json": {
      if (value === "") return { ok: true, value: definition.defaultValue };
      try {
        // Re-serialise so stored JSON is always canonical: an operator's
        // pasted formatting never shows up as a spurious diff next time.
        return { ok: true, value: JSON.stringify(JSON.parse(value)) };
      } catch {
        return { ok: false, message: "That is not valid JSON." };
      }
    }

    case "secret":
      // A blank secret means "leave what is stored alone" and is filtered out
      // before this point; a value that reaches here is a real new secret.
      return value === ""
        ? { ok: false, message: "Enter the new secret, or leave the field untouched." }
        : { ok: true, value };

    default:
      return { ok: true, value };
  }
}

/**
 * Which submitted keys are real changes.
 *
 * `current` holds the STORED strings (secrets are ciphertext). A secret whose
 * submitted value is empty is dropped rather than compared, because the form
 * never receives the stored value and an empty box means "unchanged" (D4).
 */
export function changedSettingKeys(
  definitions: readonly SettingDefinition[],
  current: Record<string, string>,
  submitted: Record<string, string>,
): string[] {
  const byKey = new Map(definitions.map((item) => [item.key, item]));
  const changed: string[] = [];

  for (const [key, raw] of Object.entries(submitted)) {
    const definition = byKey.get(key);
    if (!definition) continue;

    if (definition.type === "secret") {
      if (raw.trim() !== "") changed.push(key);
      continue;
    }
    const checked = checkSettingValue(definition, raw);
    if (!checked.ok) {
      // Invalid values are reported by validateSettingValues(); treat them as
      // changed so the caller sees the error instead of silently skipping.
      changed.push(key);
      continue;
    }
    if (checked.value !== (current[key] ?? definition.defaultValue)) changed.push(key);
  }

  return changed;
}

export type ValidationOutcome =
  | { ok: true; values: Record<string, string> }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * Validate a whole submission. Unknown keys are dropped (the form is generated
 * from the registry, so an unknown key is either stale or hostile) and blank
 * secrets never reach the database.
 */
export function validateSettingValues(
  definitions: readonly SettingDefinition[],
  submitted: Record<string, string>,
): ValidationOutcome {
  const byKey = new Map(definitions.map((item) => [item.key, item]));
  const values: Record<string, string> = {};
  const fieldErrors: Record<string, string> = {};

  for (const [key, raw] of Object.entries(submitted)) {
    const definition = byKey.get(key);
    if (!definition) continue;
    if (definition.type === "secret" && raw.trim() === "") continue;

    const checked = checkSettingValue(definition, raw);
    if (checked.ok) values[key] = checked.value;
    else fieldErrors[key] = checked.message;
  }

  return Object.keys(fieldErrors).length > 0 ? { ok: false, fieldErrors } : { ok: true, values };
}

/** Last four characters of a secret, for the "Set (••••1234)" hint. */
export function secretTail(plain: string | null | undefined): string | null {
  if (!plain) return null;
  const trimmed = plain.trim();
  return trimmed.length <= 4 ? trimmed : trimmed.slice(-4);
}
