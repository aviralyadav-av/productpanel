import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EMAIL_TEMPLATE_KEYS } from "../../lib/enums";
import { renderTemplate } from "./render";
import {
  COMMON_EMAIL_VARIABLES,
  EVENT_BY_TEMPLATE_KEY,
  describeVariable,
  documentedVariables,
  isHtmlVariable,
  previewVarsFor,
  sampleValueFor,
  sampleVarsFor,
  unknownVariablesFor,
  unusedVariablesFor,
  usedVariables,
} from "./templates-samples";

/**
 * These guard the two promises the template editor makes to an operator:
 * "these are the variables you may use" and "this is what the email will
 * look like". Both are derived from the event matrix, so a future event that
 * renames a variable must show up here rather than in a customer's inbox.
 *
 * Pure module, no database - runs as part of `npm test`.
 */

const ORDER_TEMPLATE = {
  subject: "Order {{order_id}} confirmed",
  htmlBody: "<p>Hi {{customer_name}},</p>{{order_items_html}}<p>Total {{order_total}}</p>",
  textBody: "Hi {{customer_name}}, order {{order_id}} total {{order_total}}",
};

describe("documentedVariables", () => {
  it("always starts with the three variables queueEmail injects", () => {
    for (const key of EMAIL_TEMPLATE_KEYS) {
      const names = documentedVariables(key);
      assert.deepEqual(names.slice(0, 3), [...COMMON_EMAIL_VARIABLES]);
    }
  });

  it("adds the variables the sending event supplies (E3)", () => {
    const names = documentedVariables("order_confirmation");
    for (const expected of ["customer_name", "order_id", "order_total", "order_items_html", "order_url", "payment_method"]) {
      assert.ok(names.includes(expected), `order_confirmation should document ${expected}`);
    }
  });

  it("merges the seeded list for templates no event sends", () => {
    assert.equal(EVENT_BY_TEMPLATE_KEY.password_reset, undefined);
    const names = documentedVariables("password_reset", ["name", "reset_url", "expires_minutes"]);
    assert.deepEqual(names, [...COMMON_EMAIL_VARIABLES, "name", "reset_url", "expires_minutes"]);
  });

  it("de-duplicates when the seed repeats an event variable", () => {
    const names = documentedVariables("order_confirmation", ["store_name", "order_id"]);
    assert.equal(new Set(names).size, names.length);
  });
});

describe("unknown / unused variable warnings", () => {
  it("flags a typo that would be mailed out literally", () => {
    const template = { ...ORDER_TEMPLATE, subject: "Order {{ordr_id}} confirmed" };
    assert.deepEqual(unknownVariablesFor(template, "order_confirmation"), ["ordr_id"]);
  });

  it("reports nothing when every variable is documented", () => {
    assert.deepEqual(unknownVariablesFor(ORDER_TEMPLATE, "order_confirmation"), []);
  });

  it("sees variables used only inside an {{#if}} block", () => {
    const template = {
      subject: "Hi",
      htmlBody: "{{#if tracking_nunber}}<p>{{carrier}}</p>{{/if}}",
      textBody: null,
    };
    assert.deepEqual(unknownVariablesFor(template, "order_shipped"), ["tracking_nunber"]);
  });

  it("lists documented variables the body never uses", () => {
    const unused = unusedVariablesFor(ORDER_TEMPLATE, "order_confirmation");
    assert.ok(unused.includes("order_url"));
    assert.ok(!unused.includes("order_id"));
  });

  it("collects every used name once, across subject, html and text", () => {
    assert.deepEqual(usedVariables(ORDER_TEMPLATE), [
      "order_id",
      "customer_name",
      "order_items_html",
      "order_total",
    ]);
  });
});

describe("sample data builder", () => {
  it("is deterministic", () => {
    assert.equal(sampleValueFor("order_id"), sampleValueFor("order_id"));
    assert.equal(sampleValueFor("order_id"), "DB10042");
  });

  it("derives believable values from the variable name", () => {
    assert.match(sampleValueFor("tracking_url"), /^https:\/\//);
    assert.match(sampleValueFor("billing_email"), /@/);
    assert.equal(sampleValueFor("agent_name"), "Ananya Sharma");
    assert.equal(sampleValueFor("mystery_field"), "Sample mystery field");
  });

  it("treats *_html as raw HTML", () => {
    assert.ok(isHtmlVariable("order_items_html"));
    assert.ok(sampleValueFor("order_items_html").startsWith("<table"));
  });

  it("covers every documented variable of every template key", () => {
    for (const key of EMAIL_TEMPLATE_KEYS) {
      const vars = sampleVarsFor(key);
      for (const name of documentedVariables(key)) {
        assert.ok(name in vars, `${key} is missing a sample for ${name}`);
        assert.notEqual(String(vars[name]).trim(), "");
      }
    }
  });

  it("also covers an undocumented variable so the preview is never full of braces", () => {
    const template = { ...ORDER_TEMPLATE, subject: "Order {{ordr_id}}" };
    const vars = previewVarsFor(template, "order_confirmation");
    assert.ok("ordr_id" in vars);
    assert.ok(!renderTemplate(template, vars).subject.includes("{{"));
  });
});

describe("rendering with sample data", () => {
  it("escapes ordinary values and inserts *_html raw", () => {
    const template = {
      subject: "Hi {{customer_name}}",
      htmlBody: "<p>{{customer_name}}</p>{{order_items_html}}",
      textBody: null,
    };
    const rendered = renderTemplate(template, {
      ...previewVarsFor(template, "order_confirmation"),
      customer_name: "A & B <script>",
    });
    assert.ok(rendered.html.includes("A &amp; B &lt;script&gt;"));
    assert.ok(rendered.html.includes("<table"));
    // The text part strips tags from the html variable rather than leaking markup.
    assert.ok(!rendered.text.includes("<table"));
  });

  it("leaves no placeholder behind for a fully documented template", () => {
    const rendered = renderTemplate(ORDER_TEMPLATE, previewVarsFor(ORDER_TEMPLATE, "order_confirmation"));
    assert.ok(!rendered.html.includes("{{"));
    assert.ok(!rendered.subject.includes("{{"));
    assert.ok(!rendered.text.includes("{{"));
  });
});

describe("describeVariable", () => {
  it("explains the common variables by name and the rest by suffix", () => {
    assert.match(describeVariable("store_name"), /store\.name/);
    assert.match(describeVariable("pickup_url"), /link/i);
    assert.match(describeVariable("something_html"), /unescaped/i);
    assert.equal(describeVariable("whatever"), "Supplied by the event that sends this email.");
  });
});
