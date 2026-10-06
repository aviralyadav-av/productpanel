import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countWords, excerptFromHtml, htmlToText, nextAvailableSlug, normalizeTags, readingMinutes } from "./text";

describe("htmlToText / countWords", () => {
  it("separates block elements and decodes entities", () => {
    assert.equal(htmlToText("<p>Hello</p><p>world &amp; friends</p>"), "Hello world & friends");
    assert.equal(countWords("<p>Hello</p><p>world &amp; friends</p>"), 3);
  });

  it("ignores scripts, styles and punctuation-only tokens", () => {
    assert.equal(countWords("<style>p{}</style><p>one - two … three</p><script>var x</script>"), 3);
    assert.equal(countWords(""), 0);
    assert.equal(countWords(null), 0);
  });
});

describe("readingMinutes", () => {
  it("rounds up and never reports 0 for real content", () => {
    assert.equal(readingMinutes(0), 0);
    assert.equal(readingMinutes(1), 1);
    assert.equal(readingMinutes(230), 1);
    assert.equal(readingMinutes(231), 2);
    assert.equal(readingMinutes(1150), 5);
  });

  it("accepts html directly", () => {
    const html = `<p>${Array.from({ length: 500 }, () => "word").join(" ")}</p>`;
    assert.equal(readingMinutes(html), 3);
  });
});

describe("nextAvailableSlug", () => {
  it("returns the base when free and suffixes otherwise", () => {
    assert.equal(nextAvailableSlug("about-us", []), "about-us");
    assert.equal(nextAvailableSlug("about-us", ["about-us"]), "about-us-2");
    assert.equal(nextAvailableSlug("about-us", new Set(["about-us", "about-us-2"])), "about-us-3");
  });

  it("keeps the result inside the length budget", () => {
    const base = "a".repeat(120);
    const next = nextAvailableSlug(base, [base], 120);
    assert.equal(next.length, 120);
    assert.ok(next.endsWith("-2"));
  });
});

describe("excerptFromHtml / normalizeTags", () => {
  it("cuts at a word boundary with an ellipsis", () => {
    const text = excerptFromHtml(`<p>${"lorem ipsum ".repeat(30)}</p>`, 50);
    assert.ok(text.length <= 51);
    assert.ok(text.endsWith("…"));
    assert.ok(!text.includes("  "));
  });

  it("lowercases, trims and dedupes tags", () => {
    assert.deepEqual(normalizeTags([" DIY ", "diy", "Home  Decor", ""]), ["diy", "home decor"]);
  });
});
