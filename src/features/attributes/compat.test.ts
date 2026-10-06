import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ATTRIBUTE_FILTER_TYPES, ATTRIBUTE_INPUT_TYPES } from "@/lib/enums";

import {
  COMPATIBLE_FILTER_TYPES,
  defaultFilterTypeFor,
  hasValueList,
  incompatibleFilterMessage,
  isCompatibleFilterType,
} from "./compat";

/** Run with: node --import tsx --test src/features/attributes/compat.test.ts */
describe("attribute input/filter compatibility", () => {
  it("covers every input type and only known filter types", () => {
    for (const inputType of ATTRIBUTE_INPUT_TYPES) {
      const allowed = COMPATIBLE_FILTER_TYPES[inputType];
      assert.ok(allowed.length > 0, `${inputType} has no compatible filter type`);
      for (const filterType of allowed) assert.ok(ATTRIBUTE_FILTER_TYPES.includes(filterType));
      assert.ok(allowed.includes("NONE"), `${inputType} must allow NONE`);
    }
  });

  it("pairs the blueprint combinations", () => {
    assert.equal(isCompatibleFilterType("NUMBER", "RANGE"), true);
    assert.equal(isCompatibleFilterType("COLOR", "COLOR_SWATCH"), true);
    assert.equal(isCompatibleFilterType("BOOLEAN", "TOGGLE"), true);
    assert.equal(isCompatibleFilterType("SELECT", "CHECKBOX"), true);
    assert.equal(isCompatibleFilterType("MULTI_SELECT", "RADIO"), true);
    assert.equal(isCompatibleFilterType("TEXT", "NONE"), true);
  });

  it("rejects mismatches", () => {
    assert.equal(isCompatibleFilterType("TEXT", "CHECKBOX"), false);
    assert.equal(isCompatibleFilterType("NUMBER", "CHECKBOX"), false);
    assert.equal(isCompatibleFilterType("SELECT", "RANGE"), false);
    assert.equal(isCompatibleFilterType("COLOR", "CHECKBOX"), false);
    assert.equal(isCompatibleFilterType("BOOLEAN", "RADIO"), false);
  });

  it("defaults to the first non-NONE widget", () => {
    assert.equal(defaultFilterTypeFor("NUMBER"), "RANGE");
    assert.equal(defaultFilterTypeFor("COLOR"), "COLOR_SWATCH");
    assert.equal(defaultFilterTypeFor("TEXT"), "NONE");
  });

  it("explains a rejection in operator words", () => {
    assert.match(incompatibleFilterMessage("TEXT", "CHECKBOX"), /cannot be filtered/);
    assert.match(incompatibleFilterMessage("NUMBER", "CHECKBOX"), /RANGE/);
  });

  it("knows which types carry a value list", () => {
    assert.equal(hasValueList("SELECT"), true);
    assert.equal(hasValueList("COLOR"), true);
    assert.equal(hasValueList("NUMBER"), false);
  });
});
