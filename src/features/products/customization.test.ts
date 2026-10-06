import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  priceDeltaFor,
  snapshotCustomization,
  validateCustomizationAnswers,
  type CustomizationOptionLike,
} from "./customization";

const options: CustomizationOptionLike[] = [
  { id: "name", type: "NAME", label: "Name on the mug", isRequired: true, minLength: 2, maxLength: 12, priceDeltaPaise: 0 },
  { id: "msg", type: "MESSAGE", label: "Message", isRequired: false, maxLength: 40, priceDeltaPaise: 5000 },
  {
    id: "design",
    type: "DESIGN_SELECT",
    label: "Design",
    isRequired: true,
    choices: [
      { value: "floral", label: "Floral", priceDeltaPaise: 0 },
      { value: "gold", label: "Gold foil", priceDeltaPaise: 15000 },
    ],
    priceDeltaPaise: 2500,
  },
  { id: "photo", type: "PHOTO", label: "Photo", isRequired: false, maxFiles: 2, allowedMimeTypes: ["image/jpeg", "image/png"] },
  { id: "gift", type: "CHECKBOX", label: "Gift wrap", isRequired: false, priceDeltaPaise: 4900 },
  { id: "old", type: "TEXT", label: "Retired option", isRequired: true, isActive: false },
];

describe("validateCustomizationAnswers", () => {
  it("accepts a complete, valid answer set and prices it", () => {
    const result = validateCustomizationAnswers(options, {
      name: "Asha",
      msg: "Happy birthday",
      design: "gold",
      photo: { uploadTokens: ["tok1"] },
      gift: true,
    });
    assert.equal(result.ok, true, JSON.stringify(result.problems));
    assert.equal(result.normalized.length, 5);
    // message 50 + design 25 + gold 150 + gift 49 = 274 rupees
    assert.equal(result.priceDeltaPaise, 5000 + 2500 + 15000 + 4900);
    assert.equal(priceDeltaFor(options, { name: "Asha", design: "floral" }), 2500);
  });

  it("reports every problem at once", () => {
    const result = validateCustomizationAnswers(options, {
      name: "A",
      msg: "x".repeat(41),
      design: "neon",
      photo: ["a", "b", "c"],
      gift: "maybe",
      ghost: "boo",
    });
    assert.equal(result.ok, false);
    const codes = result.problems.map((problem) => `${problem.optionId}:${problem.code}`).sort();
    assert.deepEqual(codes, [
      "design:INVALID_CHOICE",
      "ghost:UNKNOWN_OPTION",
      "gift:INVALID_TYPE",
      "msg:TOO_LONG",
      "name:TOO_SHORT",
      "photo:TOO_MANY_FILES",
    ]);
  });

  it("requires required options and ignores inactive ones", () => {
    const result = validateCustomizationAnswers(options, { old: "still here" });
    const codes = result.problems.map((problem) => `${problem.optionId}:${problem.code}`).sort();
    assert.deepEqual(codes, ["design:REQUIRED", "name:REQUIRED", "old:UNKNOWN_OPTION"]);
  });

  it("checks file mime types when provided", () => {
    const result = validateCustomizationAnswers(
      options,
      { name: "Asha", design: "floral", photo: ["t1"] },
      { fileMimeTypes: { t1: "image/webp" } },
    );
    assert.equal(result.ok, false);
    assert.equal(result.problems[0]?.code, "INVALID_FILE_TYPE");
  });

  it("an unticked checkbox adds no surcharge; a required one must be ticked", () => {
    assert.equal(priceDeltaFor(options, { name: "Asha", design: "floral", gift: false }), 2500);
    const required = validateCustomizationAnswers(
      [{ id: "c", type: "CHECKBOX", label: "Agree", isRequired: true }],
      { c: false },
    );
    assert.equal(required.problems[0]?.code, "REQUIRED");
  });

  it("builds the order snapshot with resolved files", () => {
    const result = validateCustomizationAnswers(options, { name: "Asha", design: "gold", photo: ["tok1", "tok2"] });
    const snapshot = snapshotCustomization(result.normalized, {
      tok1: { mediaAssetId: "m1", url: "/api/admin/media/m1/file" },
    });
    const photo = snapshot.find((entry) => entry.optionId === "photo");
    assert.deepEqual(photo?.fileUrls, ["/api/admin/media/m1/file"]);
    assert.deepEqual(photo?.mediaAssetIds, ["m1"]);
    const design = snapshot.find((entry) => entry.optionId === "design");
    assert.equal(design?.value, "Gold foil");
    assert.deepEqual(design?.choiceValues, ["gold"]);
    assert.equal(design?.priceDeltaPaise, 17500);
  });
});
