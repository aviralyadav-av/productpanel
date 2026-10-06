import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { periodKey, periodStart } from "./period";

/** Run with: node --import tsx --test src/lib/queue/handlers/period.test.ts */

describe("recurring period buckets", () => {
  const now = new Date("2026-09-08T10:23:45.678Z");

  it("floors to the bucket start", () => {
    assert.equal(periodStart("15min", now).toISOString(), "2026-09-08T10:15:00.000Z");
    assert.equal(periodStart("hourly", now).toISOString(), "2026-09-08T10:00:00.000Z");
    assert.equal(periodStart("daily", now).toISOString(), "2026-09-08T00:00:00.000Z");
  });

  it("builds one stable dedupe key per bucket", () => {
    assert.equal(periodKey("rate_limit.purge", "daily", now), "rate_limit.purge:daily:2026-09-08");
    assert.equal(periodKey("uploads.purge_pending", "hourly", now), "uploads.purge_pending:hourly:2026-09-08T10");
    assert.equal(periodKey("orders.expire_unpaid", "15min", now), "orders.expire_unpaid:15min:2026-09-08T10:15");
  });

  it("changes the key only when the bucket rolls over", () => {
    const later = new Date("2026-09-08T10:29:59.999Z");
    const next = new Date("2026-09-08T10:30:00.000Z");
    assert.equal(periodKey("x", "15min", now), periodKey("x", "15min", later));
    assert.notEqual(periodKey("x", "15min", later), periodKey("x", "15min", next));
    assert.equal(periodKey("x", "hourly", later), periodKey("x", "hourly", next));
  });
});
