import type { FieldDescriptor, SectionDefinition } from "./registry";

// ---------------------------------------------------------------------------
// Payload <-> form value conversion
//
// Form controls speak strings and booleans; payloads hold numbers, arrays and
// objects. Both directions are driven by the same descriptor list, so a field
// can never be read with one shape and written back with another.
// ---------------------------------------------------------------------------

export type FormValue = string | boolean;
export type FormValues = Record<string, FormValue>;

function toLines(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join("\n");
  return value === null || value === undefined ? "" : String(value);
}

function toList(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  return value === null || value === undefined ? "" : String(value);
}

function toPairs(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      const record = (item ?? {}) as Record<string, unknown>;
      return `${String(record.value ?? "")} | ${String(record.label ?? "")}`;
    })
    .join("\n");
}

export function payloadToFormValues(
  fields: FieldDescriptor[],
  payload: Record<string, unknown>,
): FormValues {
  const values: FormValues = {};

  for (const field of fields) {
    const raw = payload[field.name];

    if (field.type === "boolean") {
      values[field.name] = raw === true || raw === "true";
      continue;
    }
    if (field.format === "lines") {
      values[field.name] = toLines(raw);
      continue;
    }
    if (field.format === "list" || field.type === "entity-list") {
      values[field.name] = toList(raw);
      continue;
    }
    if (field.format === "pairs") {
      values[field.name] = toPairs(raw);
      continue;
    }
    values[field.name] = raw === null || raw === undefined ? "" : String(raw);
  }

  return values;
}

export function formValuesToPayload(
  fields: FieldDescriptor[],
  values: FormValues,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const field of fields) {
    const raw = values[field.name];

    if (field.type === "boolean") {
      payload[field.name] = raw === true;
      continue;
    }

    const value = typeof raw === "string" ? raw : "";

    if (field.type === "number") {
      // An empty number field means "leave it to the schema default" rather
      // than "zero", which would silently switch a carousel off.
      if (value.trim() === "") continue;
      payload[field.name] = Number(value);
      continue;
    }

    if (field.format === "lines") {
      payload[field.name] = value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      continue;
    }

    if (field.format === "list" || field.type === "entity-list") {
      payload[field.name] = value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean);
      continue;
    }

    if (field.format === "pairs") {
      payload[field.name] = value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [head, ...rest] = line.split("|");
          return { value: (head ?? "").trim(), label: rest.join("|").trim() };
        });
      continue;
    }

    if (field.type === "entity") {
      payload[field.name] = value.trim() === "" ? null : value.trim();
      continue;
    }

    payload[field.name] = value;
  }

  return payload;
}

/** An empty payload for a brand new block, so required fields render blank. */
export function emptyBlockPayload(definition: SectionDefinition): Record<string, unknown> {
  const values: FormValues = {};
  for (const field of definition.blockFields) {
    values[field.name] = field.type === "boolean" ? false : (field.options?.[0] ?? "");
  }
  return formValuesToPayload(definition.blockFields, values);
}

/** The label a block row shows in the list. */
export function blockLabel(
  definition: SectionDefinition,
  payload: Record<string, unknown>,
  index: number,
): string {
  const key = definition.blockTitleKey;
  const raw = key ? payload[key] : undefined;
  const label = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (label) return label;
  return `${definition.blockNoun} ${index + 1}`;
}

