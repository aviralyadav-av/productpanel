import { isChoiceType, isFileType } from "./schemas";

/**
 * Customisation answers (blueprint §11.9, D10) - the PURE half the ORDERS
 * module calls at checkout and the editor uses for its live preview.
 *
 *   validateCustomizationAnswers(options, answers) -> { ok, problems, normalized }
 *   priceDeltaFor(options, answers)                -> paise per unit
 *   snapshotCustomization(options, answers, files) -> OrderItem.customization
 *
 * `options` is the product's CustomizationOption rows (any superset of the
 * fields below), `answers` is what the storefront posted: `{ [optionId]: value }`
 * where value is a string (text / single choice), string[] (multi choice or
 * upload tokens), boolean (checkbox) or an object `{ uploadTokens: string[] }`.
 *
 * No database, no Next: unit-tested with node:test.
 */

export type CustomizationChoiceLike = {
  value: string;
  label?: string | null;
  priceDeltaPaise?: number | null;
  imageUrl?: string | null;
};

export type CustomizationOptionLike = {
  id: string;
  type: string;
  label: string;
  isRequired: boolean;
  isActive?: boolean;
  minLength?: number | null;
  maxLength?: number | null;
  maxFiles?: number | null;
  allowedMimeTypes?: readonly string[] | null;
  /** Prisma Json: [{ value, label, priceDeltaPaise, imageUrl }]. */
  choices?: unknown;
  priceDeltaPaise?: number | null;
};

export type CustomizationAnswer =
  | string
  | number
  | boolean
  | null
  | undefined
  | string[]
  | { uploadTokens?: string[]; value?: string | string[] | boolean };

export type CustomizationAnswers = Record<string, CustomizationAnswer>;

export type CustomizationProblem = {
  optionId: string;
  label: string;
  code:
    | "REQUIRED"
    | "TOO_SHORT"
    | "TOO_LONG"
    | "INVALID_CHOICE"
    | "TOO_MANY_FILES"
    | "INVALID_FILE_TYPE"
    | "UNKNOWN_OPTION"
    | "INVALID_TYPE";
  message: string;
};

/** One answer, normalised to the shape the order snapshot stores. */
export type NormalizedAnswer = {
  optionId: string;
  type: string;
  label: string;
  /** Text, choice value(s) joined, "Yes"/"No", or file count summary. */
  value: string;
  /** Choice values for choice types; empty otherwise. */
  choiceValues: string[];
  /** Upload tokens for file types; exchanged by the orders module. */
  uploadTokens: string[];
  /** Option surcharge + selected choices' surcharges, per unit. */
  priceDeltaPaise: number;
};

export type CustomizationValidation = {
  ok: boolean;
  problems: CustomizationProblem[];
  normalized: NormalizedAnswer[];
  /** Sum of every normalised answer's priceDeltaPaise (per unit). */
  priceDeltaPaise: number;
};

export const DEFAULT_CUSTOMIZATION_MIMES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function parseChoices(raw: unknown): Array<Required<CustomizationChoiceLike>> {
  if (!Array.isArray(raw)) return [];
  const out: Array<Required<CustomizationChoiceLike>> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const value = typeof record.value === "string" ? record.value : typeof record.label === "string" ? record.label : null;
    if (value === null) continue;
    const delta = Number(record.priceDeltaPaise ?? 0);
    out.push({
      value,
      label: typeof record.label === "string" ? record.label : value,
      priceDeltaPaise: Number.isFinite(delta) ? Math.round(delta) : 0,
      imageUrl: typeof record.imageUrl === "string" ? record.imageUrl : null,
    });
  }
  return out;
}

function isBlank(value: CustomizationAnswer): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    if (Array.isArray(value.uploadTokens) && value.uploadTokens.length > 0) return false;
    return isBlank(value.value as CustomizationAnswer);
  }
  return false;
}

function asStringList(value: CustomizationAnswer): string[] | null {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  if (value && typeof value === "object") {
    if (Array.isArray(value.uploadTokens)) return value.uploadTokens.filter((item): item is string => typeof item === "string");
    return asStringList(value.value as CustomizationAnswer);
  }
  return null;
}

function asText(value: CustomizationAnswer): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && !Array.isArray(value) && typeof value.value === "string") return value.value;
  return null;
}

function asBool(value: CustomizationAnswer): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(lower)) return true;
    if (["false", "0", "no", "off", ""].includes(lower)) return false;
    return null;
  }
  if (value && typeof value === "object" && !Array.isArray(value) && typeof value.value === "boolean") return value.value;
  return null;
}

/** Only active options take part; inactive ones are ignored even if answered. */
export function activeOptions<T extends CustomizationOptionLike>(options: readonly T[]): T[] {
  return options.filter((option) => option.isActive !== false);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate the answers a customer gave against a product's options. Every
 * problem is reported at once. `normalized` is only complete when `ok`.
 *
 * `fileMimeTypes` (optional) maps an upload token to its detected mime type
 * so file answers can be checked against `allowedMimeTypes`; the orders
 * module fills it from PendingUpload rows before calling.
 */
export function validateCustomizationAnswers(
  options: readonly CustomizationOptionLike[],
  answers: CustomizationAnswers | null | undefined,
  context: { fileMimeTypes?: Record<string, string> } = {},
): CustomizationValidation {
  const given = answers ?? {};
  const problems: CustomizationProblem[] = [];
  const normalized: NormalizedAnswer[] = [];
  const live = activeOptions(options);
  const knownIds = new Set(live.map((option) => option.id));

  for (const optionId of Object.keys(given)) {
    if (!knownIds.has(optionId) && !isBlank(given[optionId])) {
      const inactive = options.find((option) => option.id === optionId);
      problems.push({
        optionId,
        label: inactive?.label ?? optionId,
        code: "UNKNOWN_OPTION",
        message: inactive ? `"${inactive.label}" is no longer offered on this product.` : "Unknown customisation option.",
      });
    }
  }

  for (const option of live) {
    const answer = given[option.id];
    const blank = isBlank(answer);
    const baseDelta = Math.round(option.priceDeltaPaise ?? 0);

    if (blank) {
      if (option.isRequired && option.type !== "CHECKBOX") {
        problems.push({ optionId: option.id, label: option.label, code: "REQUIRED", message: `${option.label} is required.` });
      } else if (option.type === "CHECKBOX" && option.isRequired) {
        problems.push({ optionId: option.id, label: option.label, code: "REQUIRED", message: `${option.label} must be ticked.` });
      }
      continue;
    }

    if (option.type === "CHECKBOX") {
      const checked = asBool(answer);
      if (checked === null) {
        problems.push({ optionId: option.id, label: option.label, code: "INVALID_TYPE", message: `${option.label} must be yes or no.` });
        continue;
      }
      if (option.isRequired && !checked) {
        problems.push({ optionId: option.id, label: option.label, code: "REQUIRED", message: `${option.label} must be ticked.` });
        continue;
      }
      normalized.push({
        optionId: option.id,
        type: option.type,
        label: option.label,
        value: checked ? "Yes" : "No",
        choiceValues: [],
        uploadTokens: [],
        priceDeltaPaise: checked ? baseDelta : 0,
      });
      continue;
    }

    if (isChoiceType(option.type)) {
      const choices = parseChoices(option.choices);
      const byValue = new Map(choices.map((choice) => [choice.value, choice]));
      const picked = asStringList(answer);
      if (picked === null || picked.length === 0) {
        problems.push({ optionId: option.id, label: option.label, code: "INVALID_TYPE", message: `${option.label} needs a choice.` });
        continue;
      }
      // Single-choice types accept exactly one value; DROPDOWN too.
      if (picked.length > 1) {
        problems.push({ optionId: option.id, label: option.label, code: "INVALID_CHOICE", message: `Choose one option for ${option.label}.` });
        continue;
      }
      const unknown = picked.filter((value) => !byValue.has(value));
      if (unknown.length > 0) {
        problems.push({
          optionId: option.id,
          label: option.label,
          code: "INVALID_CHOICE",
          message: `"${unknown[0]}" is not an available choice for ${option.label}.`,
        });
        continue;
      }
      const selected = picked.map((value) => byValue.get(value) as Required<CustomizationChoiceLike>);
      normalized.push({
        optionId: option.id,
        type: option.type,
        label: option.label,
        value: selected.map((choice) => choice.label).join(", "),
        choiceValues: selected.map((choice) => choice.value),
        uploadTokens: [],
        priceDeltaPaise: baseDelta + selected.reduce((sum, choice) => sum + (choice.priceDeltaPaise ?? 0), 0),
      });
      continue;
    }

    if (isFileType(option.type)) {
      const tokens = asStringList(answer);
      if (tokens === null || tokens.length === 0) {
        problems.push({ optionId: option.id, label: option.label, code: "INVALID_TYPE", message: `${option.label} needs an upload.` });
        continue;
      }
      const maxFiles = option.maxFiles ?? 1;
      if (tokens.length > maxFiles) {
        problems.push({
          optionId: option.id,
          label: option.label,
          code: "TOO_MANY_FILES",
          message: `${option.label} accepts at most ${maxFiles} file${maxFiles === 1 ? "" : "s"}.`,
        });
        continue;
      }
      const allowed = option.allowedMimeTypes && option.allowedMimeTypes.length > 0 ? option.allowedMimeTypes : DEFAULT_CUSTOMIZATION_MIMES;
      if (context.fileMimeTypes) {
        const bad = tokens.find((token) => {
          const mime = context.fileMimeTypes?.[token];
          return mime !== undefined && !allowed.includes(mime);
        });
        if (bad) {
          problems.push({
            optionId: option.id,
            label: option.label,
            code: "INVALID_FILE_TYPE",
            message: `${option.label} accepts ${allowed.map((mime) => mime.replace("image/", "").toUpperCase()).join(", ")} only.`,
          });
          continue;
        }
      }
      normalized.push({
        optionId: option.id,
        type: option.type,
        label: option.label,
        value: `${tokens.length} file${tokens.length === 1 ? "" : "s"}`,
        choiceValues: [],
        uploadTokens: tokens,
        priceDeltaPaise: baseDelta,
      });
      continue;
    }

    // Text-like (TEXT, NAME, MESSAGE, ENGRAVING, INSTRUCTIONS) and any unknown type.
    const text = asText(answer);
    if (text === null) {
      problems.push({ optionId: option.id, label: option.label, code: "INVALID_TYPE", message: `${option.label} must be text.` });
      continue;
    }
    const trimmed = text.trim();
    {
      if (option.minLength !== null && option.minLength !== undefined && trimmed.length < option.minLength) {
        problems.push({
          optionId: option.id,
          label: option.label,
          code: "TOO_SHORT",
          message: `${option.label} must be at least ${option.minLength} characters.`,
        });
        continue;
      }
      const max = option.maxLength ?? 2000;
      if (trimmed.length > max) {
        problems.push({
          optionId: option.id,
          label: option.label,
          code: "TOO_LONG",
          message: `${option.label} must be at most ${max} characters.`,
        });
        continue;
      }
    }
    normalized.push({
      optionId: option.id,
      type: option.type,
      label: option.label,
      value: trimmed,
      choiceValues: [],
      uploadTokens: [],
      priceDeltaPaise: baseDelta,
    });
  }

  return {
    ok: problems.length === 0,
    problems,
    normalized,
    priceDeltaPaise: normalized.reduce((sum, answer) => sum + answer.priceDeltaPaise, 0),
  };
}

/**
 * Per-unit surcharge for the given answers: each answered option's own
 * `priceDeltaPaise` plus the delta of every selected choice. Unanswered and
 * inactive options add nothing; an unticked checkbox adds nothing.
 */
export function priceDeltaFor(options: readonly CustomizationOptionLike[], answers: CustomizationAnswers | null | undefined): number {
  return validateCustomizationAnswers(options, answers).normalized.reduce((sum, answer) => sum + answer.priceDeltaPaise, 0);
}

// ---------------------------------------------------------------------------
// Order snapshot (OrderItem.customization)
// ---------------------------------------------------------------------------

/** `[{ optionId, type, label, value, fileUrls[], priceDeltaPaise }]` per the schema comment. */
export type CustomizationSnapshotEntry = {
  optionId: string;
  type: string;
  label: string;
  value: string;
  choiceValues: string[];
  fileUrls: string[];
  mediaAssetIds: string[];
  priceDeltaPaise: number;
};

/**
 * Build the frozen snapshot the orders module stores on the line. `files`
 * maps an upload token to the MediaAsset it became (see consumeUploadTokens
 * in ./customization-uploads.ts); tokens without a mapping are dropped.
 */
export function snapshotCustomization(
  normalized: readonly NormalizedAnswer[],
  files: Record<string, { mediaAssetId: string; url: string }> = {},
): CustomizationSnapshotEntry[] {
  return normalized.map((answer) => {
    const resolved = answer.uploadTokens.map((token) => files[token]).filter((item): item is { mediaAssetId: string; url: string } => Boolean(item));
    return {
      optionId: answer.optionId,
      type: answer.type,
      label: answer.label,
      value: answer.value,
      choiceValues: answer.choiceValues,
      fileUrls: resolved.map((item) => item.url),
      mediaAssetIds: resolved.map((item) => item.mediaAssetId),
      priceDeltaPaise: answer.priceDeltaPaise,
    };
  });
}

/**
 * The attribute snapshot for OrderItem.attributesSnapshot: the variant's
 * attribute/value labels plus the product's own select values, as
 * `[{ code, name, value, label }]`.
 */
export type AttributeSnapshotEntry = { code: string; name: string; value: string; label: string };

export function snapshotAttributes(
  rows: ReadonlyArray<{
    attribute: { code: string; name: string };
    value: { value: string; label: string | null } | null;
    textValue?: string | null;
    numberValue?: number | null;
    boolValue?: boolean | null;
  }>,
): AttributeSnapshotEntry[] {
  return rows.flatMap((row) => {
    if (row.value) {
      return [{ code: row.attribute.code, name: row.attribute.name, value: row.value.value, label: row.value.label ?? row.value.value }];
    }
    const scalar =
      row.textValue !== null && row.textValue !== undefined
        ? row.textValue
        : row.numberValue !== null && row.numberValue !== undefined
          ? String(row.numberValue)
          : row.boolValue !== null && row.boolValue !== undefined
            ? row.boolValue
              ? "Yes"
              : "No"
            : null;
    return scalar === null ? [] : [{ code: row.attribute.code, name: row.attribute.name, value: scalar, label: scalar }];
  });
}
