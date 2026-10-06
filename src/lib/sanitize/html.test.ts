import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { sanitizeHtml, stripHtml, isAllowedImageSrc, isExternalHref } from "./html";

// env.ts reads lazily, so setting these after import (but before any call) works.
process.env.APP_ORIGIN = "http://localhost:3000";
process.env.STOREFRONT_ORIGINS = "http://localhost:5173";
process.env.S3_PUBLIC_URL = "https://cdn.example.com";

describe("sanitizeHtml", () => {
  it("removes script tags and their content", () => {
    const out = sanitizeHtml('<p>hi</p><script>alert("x")</script><p>there</p>');
    assert.equal(out, "<p>hi</p><p>there</p>");
  });

  it("drops event handlers, style, class and data attributes", () => {
    const out = sanitizeHtml(
      '<p class="x" style="color:red" data-track="1" onclick="evil()">t</p><img src="/media/a.jpg" onerror="evil()" alt="a">',
    );
    assert.equal(out, '<p>t</p><img src="/media/a.jpg" alt="a" />');
  });

  it("marks external links and leaves internal ones alone", () => {
    const external = sanitizeHtml('<a href="https://example.com/x" title="t">x</a>');
    assert.equal(
      external,
      '<a href="https://example.com/x" title="t" rel="noopener noreferrer nofollow" target="_blank">x</a>',
    );
    const internal = sanitizeHtml('<a href="/products/bags">x</a>');
    assert.equal(internal, '<a href="/products/bags">x</a>');
    const storefront = sanitizeHtml('<a href="http://localhost:5173/cart">x</a>');
    assert.equal(storefront, '<a href="http://localhost:5173/cart">x</a>');
  });

  it("rejects javascript: and data: URIs", () => {
    assert.equal(sanitizeHtml('<a href="javascript:alert(1)">x</a>'), "<a>x</a>");
    assert.equal(sanitizeHtml('<img src="data:image/png;base64,AAAA" alt="a">'), "");
    assert.equal(sanitizeHtml('<a href="data:text/html,<script>1</script>">x</a>'), "<a>x</a>");
  });

  it("only keeps images from app media origins", () => {
    assert.equal(sanitizeHtml('<img src="https://evil.example/p.gif">'), "");
    assert.equal(sanitizeHtml('<img src="//evil.example/p.gif">'), "");
    assert.equal(
      sanitizeHtml('<img src="https://cdn.example.com/public/a/b.webp" width="10" height="abc">'),
      '<img src="https://cdn.example.com/public/a/b.webp" width="10" />',
    );
    assert.equal(
      sanitizeHtml('<img src="http://localhost:3000/media/x.jpg">'),
      '<img src="http://localhost:3000/media/x.jpg" />',
    );
  });

  it("basic profile strips headings, images and tables", () => {
    const out = sanitizeHtml("<h2>H</h2><p>p</p><img src='/a.jpg'><table><tr><td>c</td></tr></table>", "basic");
    assert.equal(out, "H<p>p</p>c");
  });

  it("rich profile keeps the D12 allowlist", () => {
    const out = sanitizeHtml(
      "<h2>H</h2><blockquote>q</blockquote><pre><code>c</code></pre><hr><table><thead><tr><th colspan='2'>a</th></tr></thead></table><figure><figcaption>f</figcaption></figure>",
    );
    assert.equal(
      out,
      '<h2>H</h2><blockquote>q</blockquote><pre><code>c</code></pre><hr /><table><thead><tr><th colspan="2">a</th></tr></thead></table><figure><figcaption>f</figcaption></figure>',
    );
  });

  it("email profile allows table layout attributes but no style", () => {
    const out = sanitizeHtml('<table width="600" style="x"><tr><td align="left">c</td></tr></table>', "email");
    assert.equal(out, '<table width="600"><tr><td align="left">c</td></tr></table>');
  });

  it("handles empty input", () => {
    assert.equal(sanitizeHtml(null), "");
    assert.equal(sanitizeHtml(""), "");
  });
});

describe("stripHtml", () => {
  it("returns decoded text with block breaks", () => {
    assert.equal(stripHtml("<p>a &amp; b</p><p>c<br>d</p><script>x</script>"), "a & b\nc\nd");
    assert.equal(stripHtml("&#8377;100 &nbsp;&lt;tag&gt;"), "₹100  <tag>");
  });
});

describe("origin helpers", () => {
  it("classifies hrefs and srcs", () => {
    assert.equal(isExternalHref("/x"), false);
    assert.equal(isExternalHref("#top"), false);
    assert.equal(isExternalHref("mailto:a@b.c"), false);
    assert.equal(isExternalHref("http://localhost:3000/admin"), false);
    assert.equal(isExternalHref("https://google.com"), true);
    assert.equal(isAllowedImageSrc("/media/a.jpg"), true);
    assert.equal(isAllowedImageSrc("https://cdn.example.com/x.png"), true);
    assert.equal(isAllowedImageSrc("https://cdn.example.com.evil.io/x.png"), false);
  });
});
