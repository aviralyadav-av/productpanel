import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveFromRows,
  type AttributeRow,
  type AttributeValueRow,
  type CategoryAttributeRow,
} from "./attribute-resolution-core";

/**
 * Run with: node --import tsx --test src/features/catalog/attribute-resolution.test.ts
 *
 * Fixture tree: fashion (root) → kurta → womens-kurta. Attributes: colour
 * (global), material, size, pattern, weight (range).
 */

function attribute(partial: Partial<AttributeRow> & Pick<AttributeRow, "id" | "code">): AttributeRow {
  return {
    name: partial.code,
    inputType: "SELECT",
    filterType: "CHECKBOX",
    unit: null,
    isVariantDefining: false,
    isFilterableDefault: true,
    isGlobal: false,
    position: 0,
    isActive: true,
    ...partial,
  };
}

function row(
  partial: Partial<CategoryAttributeRow> & Pick<CategoryAttributeRow, "categoryId" | "attributeId">,
): CategoryAttributeRow {
  return {
    id: `${partial.categoryId}:${partial.attributeId}`,
    isRequired: false,
    isFilterable: true,
    isVariant: false,
    showInSpecs: true,
    inheritToChildren: true,
    isExcluded: false,
    position: 0,
    ...partial,
  };
}

function value(attributeId: string, id: string, position: number, isActive = true): AttributeValueRow {
  return { id, attributeId, value: id, label: id.toUpperCase(), colorHex: null, position, isActive };
}

const ATTRIBUTES: AttributeRow[] = [
  attribute({ id: "colour", code: "colour", inputType: "COLOR", filterType: "COLOR_SWATCH", isGlobal: true, isVariantDefining: true, position: 1 }),
  attribute({ id: "material", code: "material", position: 2 }),
  attribute({ id: "size", code: "size", isVariantDefining: true, position: 3 }),
  attribute({ id: "pattern", code: "pattern", position: 4 }),
  attribute({ id: "weight", code: "weight", inputType: "NUMBER", filterType: "RANGE", unit: "g", position: 5 }),
  attribute({ id: "retired", code: "retired", isGlobal: true, isActive: false }),
];

const VALUES: AttributeValueRow[] = [
  value("colour", "red", 2),
  value("colour", "blue", 1),
  value("colour", "green", 3, false),
  value("size", "m", 2),
  value("size", "s", 1),
  value("material", "cotton", 1),
];

const PATH = ["fashion", "kurta", "womens-kurta"];

describe("resolveFromRows", () => {
  it("starts from active globals only, with the attribute's own defaults", () => {
    const result = resolveFromRows([], [], ATTRIBUTES, VALUES);
    assert.deepEqual(result.map((entry) => entry.attribute.code), ["colour"]);
    const colour = result[0];
    assert.equal(colour.source, "global");
    assert.equal(colour.sourceCategoryId, null);
    assert.equal(colour.isVariant, true);
    assert.equal(colour.isFilterable, true);
    assert.equal(colour.isRequired, false);
  });

  it("orders values by position and drops inactive ones", () => {
    const result = resolveFromRows([], [], ATTRIBUTES, VALUES);
    assert.deepEqual(result[0].values.map((v) => v.id), ["blue", "red"]);
  });

  it("inherits rows down the path and labels their source", () => {
    const rows = [
      row({ categoryId: "fashion", attributeId: "material", position: 1 }),
      row({ categoryId: "kurta", attributeId: "size", isVariant: true, isRequired: true, position: 2 }),
      row({ categoryId: "womens-kurta", attributeId: "pattern", position: 3 }),
    ];
    const result = resolveFromRows(PATH, rows, ATTRIBUTES, VALUES);
    const byCode = new Map(result.map((entry) => [entry.attribute.code, entry]));

    assert.equal(byCode.get("material")?.source, "inherited");
    assert.equal(byCode.get("material")?.sourceCategoryId, "fashion");
    assert.equal(byCode.get("size")?.source, "inherited");
    assert.equal(byCode.get("size")?.isRequired, true);
    assert.equal(byCode.get("size")?.isVariant, true);
    assert.equal(byCode.get("pattern")?.source, "own");
    assert.equal(byCode.get("pattern")?.sourceCategoryId, "womens-kurta");
    assert.equal(byCode.get("colour")?.source, "global");
  });

  it("lets a deeper row fully replace a shallower one", () => {
    const rows = [
      row({ categoryId: "fashion", attributeId: "material", isRequired: false, isFilterable: true, position: 9 }),
      row({ categoryId: "womens-kurta", attributeId: "material", isRequired: true, isFilterable: false, position: 1 }),
    ];
    const result = resolveFromRows(PATH, rows, ATTRIBUTES, VALUES);
    const material = result.find((entry) => entry.attribute.code === "material");
    assert.equal(material?.source, "own");
    assert.equal(material?.isRequired, true);
    assert.equal(material?.isFilterable, false);
    assert.equal(material?.position, 1);
    assert.equal(material?.categoryAttributeId, "womens-kurta:material");
  });

  it("lets a category row override a global", () => {
    const rows = [row({ categoryId: "kurta", attributeId: "colour", isRequired: true, isVariant: false })];
    const result = resolveFromRows(PATH, rows, ATTRIBUTES, VALUES);
    const colour = result.find((entry) => entry.attribute.code === "colour");
    assert.equal(colour?.source, "inherited");
    assert.equal(colour?.isRequired, true);
    assert.equal(colour?.isVariant, false);
  });

  it("ignores non-inheriting rows above the target but honours them on the target", () => {
    const rows = [
      row({ categoryId: "fashion", attributeId: "material", inheritToChildren: false }),
      row({ categoryId: "womens-kurta", attributeId: "pattern", inheritToChildren: false }),
    ];
    const result = resolveFromRows(PATH, rows, ATTRIBUTES, VALUES);
    const codes = result.map((entry) => entry.attribute.code);
    assert.ok(!codes.includes("material"));
    assert.ok(codes.includes("pattern"));

    // On fashion itself the non-inheriting row is "own".
    const onRoot = resolveFromRows(["fashion"], rows, ATTRIBUTES, VALUES);
    assert.equal(onRoot.find((entry) => entry.attribute.code === "material")?.source, "own");
  });

  it("excludes an attribute for a category and its descendants, until re-added deeper", () => {
    const rows = [
      row({ categoryId: "fashion", attributeId: "material" }),
      row({ categoryId: "kurta", attributeId: "material", isExcluded: true }),
      row({ categoryId: "kurta", attributeId: "colour", isExcluded: true }),
    ];
    const atKurta = resolveFromRows(["fashion", "kurta"], rows, ATTRIBUTES, VALUES);
    assert.deepEqual(atKurta.map((entry) => entry.attribute.code), []);

    const atLeaf = resolveFromRows(PATH, rows, ATTRIBUTES, VALUES);
    assert.deepEqual(atLeaf.map((entry) => entry.attribute.code), []);

    const reAdded = resolveFromRows(
      PATH,
      [...rows, row({ categoryId: "womens-kurta", attributeId: "material" })],
      ATTRIBUTES,
      VALUES,
    );
    assert.deepEqual(reAdded.map((entry) => entry.attribute.code), ["material"]);
    assert.equal(reAdded[0].source, "own");
  });

  it("skips inactive attributes and gives scalar attributes no values", () => {
    const rows = [
      row({ categoryId: "fashion", attributeId: "weight" }),
      row({ categoryId: "fashion", attributeId: "retired" }),
    ];
    const result = resolveFromRows(PATH, rows, ATTRIBUTES, VALUES);
    const codes = result.map((entry) => entry.attribute.code);
    assert.ok(!codes.includes("retired"));
    const weight = result.find((entry) => entry.attribute.code === "weight");
    assert.deepEqual(weight?.values, []);
    assert.equal(weight?.attribute.unit, "g");
  });

  it("sorts category rows by position before globals", () => {
    const rows = [
      row({ categoryId: "fashion", attributeId: "pattern", position: 5 }),
      row({ categoryId: "fashion", attributeId: "size", position: 2 }),
    ];
    const result = resolveFromRows(PATH, rows, ATTRIBUTES, VALUES);
    assert.deepEqual(result.map((entry) => entry.attribute.code), ["size", "pattern", "colour"]);
  });
});
