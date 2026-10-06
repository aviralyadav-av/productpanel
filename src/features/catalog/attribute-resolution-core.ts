/**
 * The EFFECTIVE attribute set of a category (blueprint §14.A1).
 *
 * A category's attributes are not the rows on that category. They are: every
 * global attribute, plus every ancestor's rows that inherit downwards, plus the
 * category's own rows - where a deeper row for the same attribute replaces a
 * shallower one, and an `isExcluded` row removes the attribute for that
 * category and everything below it. The product editor, publish validation,
 * the facet builder, variant generation and the admin category page ALL call
 * this function, so "which attributes apply here" has exactly one answer.
 *
 * `resolveFromRows` is pure so the walk can be unit-tested with fixtures; the
 * `resolveCategoryAttributes` / `resolveForProduct` wrappers only load rows.
 */

export type AttributeRow = {
  id: string;
  code: string;
  name: string;
  inputType: string;
  filterType: string;
  unit: string | null;
  isVariantDefining: boolean;
  isFilterableDefault: boolean;
  isGlobal: boolean;
  position: number;
  isActive: boolean;
};

export type AttributeValueRow = {
  id: string;
  attributeId: string;
  value: string;
  label: string | null;
  colorHex: string | null;
  position: number;
  isActive: boolean;
};

export type CategoryAttributeRow = {
  id: string;
  categoryId: string;
  attributeId: string;
  isRequired: boolean;
  isFilterable: boolean;
  isVariant: boolean;
  showInSpecs: boolean;
  inheritToChildren: boolean;
  isExcluded: boolean;
  position: number;
};

export type EffectiveSource = "own" | "inherited" | "global";

export type EffectiveAttribute = {
  attribute: AttributeRow;
  values: AttributeValueRow[];
  source: EffectiveSource;
  /** The category whose row produced this entry; null for globals. */
  sourceCategoryId: string | null;
  /** The CategoryAttribute row id behind an own/inherited entry. */
  categoryAttributeId: string | null;
  isRequired: boolean;
  isFilterable: boolean;
  isVariant: boolean;
  showInSpecs: boolean;
  position: number;
};

/** Select-like attributes carry AttributeValue rows; scalar ones do not. */
export const SELECT_INPUT_TYPES: readonly string[] = ["SELECT", "MULTI_SELECT", "COLOR"];

export function isSelectType(inputType: string): boolean {
  return SELECT_INPUT_TYPES.includes(inputType);
}

function sortValues(values: readonly AttributeValueRow[]): AttributeValueRow[] {
  return values
    .filter((value) => value.isActive)
    .slice()
    .sort((x, y) => x.position - y.position || x.value.localeCompare(y.value));
}

/**
 * @param categoryPathIds  ancestor ids root → leaf; the LAST id is the target.
 *                         Empty for "no category" (globals only).
 * @param categoryAttributeRows  rows for any of those categories (others ignored).
 * @param attributes  every attribute referenced by a row plus all globals.
 * @param values  AttributeValue rows for those attributes.
 */
export function resolveFromRows(
  categoryPathIds: readonly string[],
  categoryAttributeRows: readonly CategoryAttributeRow[],
  attributes: readonly AttributeRow[],
  values: readonly AttributeValueRow[],
): EffectiveAttribute[] {
  const attributeById = new Map(attributes.map((attribute) => [attribute.id, attribute]));
  const valuesByAttribute = new Map<string, AttributeValueRow[]>();
  for (const value of values) {
    const list = valuesByAttribute.get(value.attributeId) ?? [];
    list.push(value);
    valuesByAttribute.set(value.attributeId, list);
  }

  const effective = new Map<string, EffectiveAttribute>();

  // Level 0: globals as pseudo-rows carrying the attribute's own defaults.
  for (const attribute of attributes) {
    if (!attribute.isGlobal || !attribute.isActive) continue;
    effective.set(attribute.id, {
      attribute,
      values: [],
      source: "global",
      sourceCategoryId: null,
      categoryAttributeId: null,
      isRequired: false,
      isFilterable: attribute.isFilterableDefault,
      isVariant: attribute.isVariantDefining,
      showInSpecs: true,
      position: 1000 + attribute.position,
    });
  }

  // Levels 1..n: root → leaf so a deeper row wins by being applied last.
  const rowsByCategory = new Map<string, CategoryAttributeRow[]>();
  for (const row of categoryAttributeRows) {
    const list = rowsByCategory.get(row.categoryId) ?? [];
    list.push(row);
    rowsByCategory.set(row.categoryId, list);
  }

  const targetId = categoryPathIds[categoryPathIds.length - 1];
  for (const categoryId of categoryPathIds) {
    const isTarget = categoryId === targetId;
    for (const row of rowsByCategory.get(categoryId) ?? []) {
      if (!isTarget && !row.inheritToChildren) continue;

      if (row.isExcluded) {
        effective.delete(row.attributeId);
        continue;
      }

      const attribute = attributeById.get(row.attributeId);
      if (!attribute || !attribute.isActive) continue;

      effective.set(row.attributeId, {
        attribute,
        values: [],
        source: isTarget ? "own" : "inherited",
        sourceCategoryId: categoryId,
        categoryAttributeId: row.id,
        isRequired: row.isRequired,
        isFilterable: row.isFilterable,
        isVariant: row.isVariant,
        showInSpecs: row.showInSpecs,
        position: row.position,
      });
    }
  }

  return [...effective.values()]
    .map((entry) => ({
      ...entry,
      values: isSelectType(entry.attribute.inputType)
        ? sortValues(valuesByAttribute.get(entry.attribute.id) ?? [])
        : [],
    }))
    .sort(
      (x, y) =>
        x.position - y.position ||
        x.attribute.position - y.attribute.position ||
        x.attribute.name.localeCompare(y.attribute.name),
    );
}

