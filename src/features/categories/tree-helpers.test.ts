import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ancestorIds,
  buildParentOptions,
  deepestDepthAfterMove,
  depthOf,
  descendantIdsOf,
  highlightSplit,
  nextSlugCandidate,
  searchTree,
  subtreeHeightOf,
} from "./tree-helpers";

/**
 * Run with: node --import tsx --test src/features/categories/tree-helpers.test.ts
 *
 * Fixture: root → fashion → kurta → womens-kurta; root → home; art (root).
 */
const NODES = [
  { id: "fashion", parentId: null, name: "Fashion", slug: "fashion", position: 0 },
  { id: "kurta", parentId: "fashion", name: "Kurta", slug: "kurta", position: 0 },
  { id: "womens-kurta", parentId: "kurta", name: "Women's Kurta", slug: "womens-kurta", position: 0 },
  { id: "home", parentId: null, name: "Home & Living", slug: "home-living", position: 1 },
  { id: "art", parentId: null, name: "Art", slug: "art", position: 2 },
];

describe("tree helpers", () => {
  it("walks ancestors root → leaf and computes depth", () => {
    assert.deepEqual(ancestorIds(NODES, "womens-kurta"), ["fashion", "kurta"]);
    assert.equal(depthOf(NODES, "fashion"), 0);
    assert.equal(depthOf(NODES, "womens-kurta"), 2);
    assert.equal(depthOf(NODES, "missing"), -1);
  });

  it("lists descendants and subtree height", () => {
    assert.deepEqual(new Set(descendantIdsOf(NODES, "fashion")), new Set(["kurta", "womens-kurta"]));
    assert.deepEqual(descendantIdsOf(NODES, "art"), []);
    assert.equal(subtreeHeightOf(NODES, "fashion"), 2);
    assert.equal(subtreeHeightOf(NODES, "art"), 0);
  });

  it("projects the deepest depth after a move (the whole subtree counts)", () => {
    // Moving fashion (height 2) under home (depth 0) puts womens-kurta at depth 3.
    assert.equal(deepestDepthAfterMove(NODES, "fashion", "home"), 3);
    // Moving art (leaf) to the root stays at 0.
    assert.equal(deepestDepthAfterMove(NODES, "art", null), 0);
    // Moving kurta (height 1) under womens-kurta (depth 2) would be a cycle;
    // the depth math alone says 2 + 1 + 1 = 4 - the cycle check is separate.
    assert.equal(deepestDepthAfterMove(NODES, "kurta", "womens-kurta"), 4);
  });

  it("builds indented parent options excluding self and descendants", () => {
    const options = buildParentOptions(NODES, { excludeId: "fashion" });
    assert.deepEqual(
      options.map((option) => option.value),
      ["home", "art"],
    );
    const all = buildParentOptions(NODES, { indent: "  " });
    assert.equal(all.find((option) => option.value === "womens-kurta")?.label, "    Women's Kurta");
    assert.equal(all.find((option) => option.value === "womens-kurta")?.depth, 2);
  });

  it("marks disabled ids but keeps them listed", () => {
    const options = buildParentOptions(NODES, { disabledIds: ["home"] });
    assert.equal(options.find((option) => option.value === "home")?.disabled, true);
    assert.equal(options.find((option) => option.value === "art")?.disabled, undefined);
  });

  it("searches by name or slug and keeps ancestors visible", () => {
    const result = searchTree(NODES, "kurta");
    assert.deepEqual(new Set(result.matchIds), new Set(["kurta", "womens-kurta"]));
    assert.ok(result.visibleIds.has("fashion"), "ancestor stays visible");
    assert.ok(!result.visibleIds.has("home"));

    const bySlug = searchTree(NODES, "home-living");
    assert.deepEqual([...bySlug.matchIds], ["home"]);

    const empty = searchTree(NODES, "   ");
    assert.equal(empty.matchIds.size, 0);
    assert.equal(empty.visibleIds.size, NODES.length);
  });

  it("is accent- and case-insensitive", () => {
    const nodes = [{ id: "a", parentId: null, name: "Décor", slug: "decor" }];
    assert.equal(searchTree(nodes, "DECOR").matchIds.size, 1);
    assert.equal(searchTree(nodes, "décor").matchIds.size, 1);
  });

  it("splits labels for highlighting", () => {
    assert.deepEqual(highlightSplit("Women's Kurta", "kur"), ["Women's ", "Kur", "ta"]);
    assert.equal(highlightSplit("Art", "zzz"), null);
    assert.equal(highlightSplit("Art", ""), null);
  });

  it("suffixes duplicate slugs on create (§11.23)", () => {
    assert.equal(nextSlugCandidate("kurta", new Set()), "kurta");
    assert.equal(nextSlugCandidate("kurta", new Set(["kurta"])), "kurta-2");
    assert.equal(nextSlugCandidate("kurta", new Set(["kurta", "kurta-2"])), "kurta-3");
    const long = "a".repeat(120);
    const candidate = nextSlugCandidate(long, new Set([long]), 120);
    assert.equal(candidate.length, 120);
    assert.ok(candidate.endsWith("-2"));
  });
});
