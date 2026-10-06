import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decrypt, encrypt, isEncrypted } from "@/lib/crypto";
import { SETTING_DEFINITIONS, settingDefinition } from "@/lib/settings-keys";
import {
  changedSettingKeys,
  checkSettingValue,
  secretTail,
  validateSettingValues,
} from "@/features/settings/values";

/**
 * The two rules that make the settings screen safe (blueprint §14.E2, D4):
 * what a valid value looks like per type, and "a blank secret means unchanged,
 * not cleared". The second one is worth a test because getting it wrong wipes
 * the SMTP password every time somebody saves the Email tab.
 * Run with `npm test`.
 */

// env.ts reads lazily, so setting these after import (but before any call to
// encrypt) works - `npm test` runs without an .env file.
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");
process.env.AUTH_SECRET ??= "test-auth-secret";

function def(key: string) {
  const definition = settingDefinition(key);
  assert.ok(definition, `${key} must exist in the registry`);
  return definition;
}

describe("checkSettingValue", () => {
  it("accepts only true/false for booleans", () => {
    assert.deepEqual(checkSettingValue(def("orders.cod_enabled"), "true"), {
      ok: true,
      value: "true",
    });
    assert.equal(checkSettingValue(def("orders.cod_enabled"), "yes").ok, false);
  });

  it("requires whole non-negative numbers, and says paise for money", () => {
    assert.deepEqual(checkSettingValue(def("orders.cod_fee_paise"), " 4900 "), {
      ok: true,
      value: "4900",
    });
    const fractional = checkSettingValue(def("orders.cod_fee_paise"), "49.5");
    assert.equal(fractional.ok, false);
    assert.match(fractional.ok ? "" : fractional.message, /paise/i);
    assert.equal(checkSettingValue(def("returns.window_days"), "-1").ok, false);
    assert.equal(checkSettingValue(def("returns.window_days"), "7.5").ok, false);
  });

  it("canonicalises JSON so pasted formatting is not a diff", () => {
    const result = checkSettingValue(def("checkout.blocklist"), '{  "emails" : [ ] }');
    assert.ok(result.ok);
    assert.equal(result.value, '{"emails":[]}');
    assert.equal(checkSettingValue(def("checkout.blocklist"), "{oops}").ok, false);
  });

  it("falls back to the seeded default for empty JSON", () => {
    const result = checkSettingValue(def("marketplace.charges"), "");
    assert.ok(result.ok);
    assert.equal(result.value, "[]");
  });

  it("refuses an empty secret (blank is handled earlier as 'unchanged')", () => {
    assert.equal(checkSettingValue(def("email.smtp_password"), "").ok, false);
    assert.deepEqual(checkSettingValue(def("email.smtp_password"), "hunter2"), {
      ok: true,
      value: "hunter2",
    });
  });
});

describe("validateSettingValues", () => {
  const definitions = SETTING_DEFINITIONS.filter((item) =>
    ["email.smtp_host", "email.smtp_password", "email.smtp_port"].includes(item.key),
  );

  it("drops blank secrets instead of storing an empty password", () => {
    const result = validateSettingValues(definitions, {
      "email.smtp_host": "smtp.example.test",
      "email.smtp_password": "",
      "email.smtp_port": "587",
    });
    assert.ok(result.ok);
    assert.deepEqual(Object.keys(result.values).sort(), ["email.smtp_host", "email.smtp_port"]);
  });

  it("ignores keys that are not in the registry", () => {
    const result = validateSettingValues(definitions, { "not.a.key": "x" });
    assert.ok(result.ok);
    assert.deepEqual(result.values, {});
  });

  it("reports per-field errors", () => {
    const result = validateSettingValues(definitions, { "email.smtp_port": "not-a-port" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.fieldErrors["email.smtp_port"]);
  });
});

describe("changedSettingKeys", () => {
  const definitions = SETTING_DEFINITIONS.filter((item) =>
    ["store.name", "orders.cod_fee_paise", "email.smtp_password"].includes(item.key),
  );
  const stored = {
    "store.name": "DIY Baazar",
    "orders.cod_fee_paise": "4900",
    "email.smtp_password": "v1:stored-ciphertext",
  };

  it("returns nothing when a form is submitted untouched", () => {
    assert.deepEqual(
      changedSettingKeys(definitions, stored, {
        "store.name": "DIY Baazar",
        "orders.cod_fee_paise": "4900",
        "email.smtp_password": "",
      }),
      [],
    );
  });

  it("counts a non-empty secret as a change and an empty one as unchanged", () => {
    assert.deepEqual(
      changedSettingKeys(definitions, stored, { "email.smtp_password": "new-secret" }),
      ["email.smtp_password"],
    );
    assert.deepEqual(changedSettingKeys(definitions, stored, { "email.smtp_password": "   " }), []);
  });

  it("compares the normalised value, so '4900 ' is not a change", () => {
    assert.deepEqual(changedSettingKeys(definitions, stored, { "orders.cod_fee_paise": "4900 " }), []);
    assert.deepEqual(changedSettingKeys(definitions, stored, { "orders.cod_fee_paise": "0" }), [
      "orders.cod_fee_paise",
    ]);
  });
});

describe("secret storage (D4)", () => {
  it("round-trips through the smtp purpose and never stores plaintext", () => {
    const cipher = encrypt("hunter2-hunter2", "smtp");
    assert.ok(isEncrypted(cipher));
    assert.ok(cipher.startsWith("v1:"));
    assert.notEqual(cipher, "hunter2-hunter2");
    assert.equal(decrypt(cipher, "smtp"), "hunter2-hunter2");
  });

  it("shows only the last four characters", () => {
    assert.equal(secretTail("hunter2-1234"), "1234");
    assert.equal(secretTail("abc"), "abc");
    assert.equal(secretTail(""), null);
  });
});
