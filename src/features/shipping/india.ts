/**
 * Indian states and union territories, with the two-letter codes zones store
 * in `ShippingZone.states` (blueprint §4.6). Pure data: the seed, the CSV
 * importer and the browser all import this file, so it has no dependencies.
 *
 * `stateCodeOf()` is deliberately forgiving because pincode CSVs come from
 * couriers and each spells states its own way ("Orissa", "Pondicherry", "NCT
 * of Delhi", "Jammu and Kashmir", "J&K"). Matching happens on a normalised
 * form (lowercase, alphanumerics only, "&" → "and") plus an alias table.
 */

export type IndianState = {
  code: string;
  name: string;
  type: "state" | "ut";
};

export const INDIAN_STATES: readonly IndianState[] = [
  { code: "AP", name: "Andhra Pradesh", type: "state" },
  { code: "AR", name: "Arunachal Pradesh", type: "state" },
  { code: "AS", name: "Assam", type: "state" },
  { code: "BR", name: "Bihar", type: "state" },
  { code: "CG", name: "Chhattisgarh", type: "state" },
  { code: "GA", name: "Goa", type: "state" },
  { code: "GJ", name: "Gujarat", type: "state" },
  { code: "HR", name: "Haryana", type: "state" },
  { code: "HP", name: "Himachal Pradesh", type: "state" },
  { code: "JH", name: "Jharkhand", type: "state" },
  { code: "KA", name: "Karnataka", type: "state" },
  { code: "KL", name: "Kerala", type: "state" },
  { code: "MP", name: "Madhya Pradesh", type: "state" },
  { code: "MH", name: "Maharashtra", type: "state" },
  { code: "MN", name: "Manipur", type: "state" },
  { code: "ML", name: "Meghalaya", type: "state" },
  { code: "MZ", name: "Mizoram", type: "state" },
  { code: "NL", name: "Nagaland", type: "state" },
  { code: "OD", name: "Odisha", type: "state" },
  { code: "PB", name: "Punjab", type: "state" },
  { code: "RJ", name: "Rajasthan", type: "state" },
  { code: "SK", name: "Sikkim", type: "state" },
  { code: "TN", name: "Tamil Nadu", type: "state" },
  { code: "TS", name: "Telangana", type: "state" },
  { code: "TR", name: "Tripura", type: "state" },
  { code: "UP", name: "Uttar Pradesh", type: "state" },
  { code: "UK", name: "Uttarakhand", type: "state" },
  { code: "WB", name: "West Bengal", type: "state" },
  { code: "AN", name: "Andaman and Nicobar Islands", type: "ut" },
  { code: "CH", name: "Chandigarh", type: "ut" },
  { code: "DN", name: "Dadra and Nagar Haveli and Daman and Diu", type: "ut" },
  { code: "DL", name: "Delhi", type: "ut" },
  { code: "JK", name: "Jammu and Kashmir", type: "ut" },
  { code: "LA", name: "Ladakh", type: "ut" },
  { code: "LD", name: "Lakshadweep", type: "ut" },
  { code: "PY", name: "Puducherry", type: "ut" },
];

export const INDIAN_STATE_CODES: readonly string[] = INDIAN_STATES.map((state) => state.code);

const BY_CODE = new Map(INDIAN_STATES.map((state) => [state.code, state]));

/** Lowercase alphanumerics only, "&" spelled out, so "J & K" and "j&k" agree. */
export function normalizeStateText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "");
}

const ALIASES: Record<string, string> = {
  orissa: "OD",
  uttaranchal: "UK",
  pondicherry: "PY",
  nctofdelhi: "DL",
  newdelhi: "DL",
  delhincr: "DL",
  nationalcapitalterritoryofdelhi: "DL",
  jandk: "JK",
  jammukashmir: "JK",
  jammuandkashmir: "JK",
  andamannicobar: "AN",
  andamanandnicobar: "AN",
  andamanandnicobarisland: "AN",
  andamanandnicobarislands: "AN",
  dadraandnagarhaveli: "DN",
  damananddiu: "DN",
  dadraandnagarhavelianddamananddiu: "DN",
  dadranagarhaveli: "DN",
  chattisgarh: "CG",
  chhatisgarh: "CG",
  tamilnadu: "TN",
  telengana: "TS",
  telangana: "TS",
  westbengal: "WB",
  himachal: "HP",
  madhyapradesh: "MP",
  uttarpradesh: "UP",
  andhra: "AP",
  arunachal: "AR",
};

const BY_NORMALIZED_NAME = new Map<string, string>(
  INDIAN_STATES.map((state) => [normalizeStateText(state.name), state.code]),
);

/**
 * Resolve a code ("MH"), a name ("Maharashtra") or a common variant to the
 * canonical two-letter code; null when nothing matches.
 */
export function stateCodeOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const upper = trimmed.toUpperCase();
  if (upper.length === 2 && BY_CODE.has(upper)) return upper;

  const normalized = normalizeStateText(trimmed);
  if (!normalized) return null;
  return BY_NORMALIZED_NAME.get(normalized) ?? ALIASES[normalized] ?? null;
}

export function stateName(code: string | null | undefined): string | null {
  if (!code) return null;
  return BY_CODE.get(code.toUpperCase())?.name ?? null;
}

/** Canonical display name when the text is a known state, else the text itself (trimmed). */
export function canonicalStateName(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const code = stateCodeOf(trimmed);
  return code ? (stateName(code) ?? trimmed) : trimmed;
}

/** Options for a MultiSelect, grouped so UTs sit under their own heading. */
export const INDIAN_STATE_OPTIONS = INDIAN_STATES.map((state) => ({
  value: state.code,
  label: state.name,
  description: state.code,
  group: state.type === "state" ? "States" : "Union territories",
}));
