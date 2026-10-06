import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bucketKeyFor,
  bucketKeysInRange,
  bucketLabel,
  bucketStart,
  defaultBucketFor,
  humanizeSlug,
  rollupCategoryPath,
  zeroFill,
} from "./bucketing";

/**
 * Run with: node --import tsx --test src/features/reports/bucketing.test.ts
 * The keys produced here must match what Postgres produces with
 * date_trunc(<bucket>, ts AT TIME ZONE 'Asia/Kolkata'); the reports check
 * script (src/features/reports/__checks__/reports-check.ts) proves that end
 * to end against the database. These tests pin the JS half.
 */

// 2026-09-08 20:30 UTC is 2026-09-09 02:00 IST: a different day, and the IST
// day is a Wednesday (2026-09-09), so the ISO week starts Monday 2026-09-07.
const LATE_UTC = new Date("2026-09-08T20:30:00.000Z");

describe("bucketKeyFor (IST)", () => {
  it("assigns an instant after IST midnight to the next IST day", () => {
    assert.equal(bucketKeyFor(LATE_UTC, "day"), "2026-09-09");
  });

  it("keys weeks by their Monday and months by their first day", () => {
    assert.equal(bucketKeyFor(LATE_UTC, "week"), "2026-09-07");
    assert.equal(bucketKeyFor(LATE_UTC, "month"), "2026-09-01");
  });

  it("keeps a Sunday inside the week that started the previous Monday", () => {
    // 2026-09-13 10:00 IST is a Sunday.
    const sunday = new Date("2026-09-13T04:30:00.000Z");
    assert.equal(bucketKeyFor(sunday, "week"), "2026-09-07");
  });

  it("bucketStart is IST midnight expressed in UTC", () => {
    assert.equal(bucketStart(LATE_UTC, "day").toISOString(), "2026-09-08T18:30:00.000Z");
    assert.equal(bucketStart(LATE_UTC, "month").toISOString(), "2026-08-31T18:30:00.000Z");
  });
});

describe("bucketKeysInRange", () => {
  const range = {
    from: new Date("2026-08-31T18:30:00.000Z"), // 1 Sep IST
    to: new Date("2026-09-20T18:29:59.999Z"), // end of 20 Sep IST
  };

  it("lists every IST day inclusive of both ends", () => {
    const days = bucketKeysInRange(range, "day");
    assert.equal(days.length, 20);
    assert.equal(days[0], "2026-09-01");
    assert.equal(days.at(-1), "2026-09-20");
  });

  it("starts the week list on the Monday containing `from`", () => {
    // 1 Sep 2026 is a Tuesday; its week began Monday 31 Aug.
    assert.deepEqual(bucketKeysInRange(range, "week"), ["2026-08-31", "2026-09-07", "2026-09-14"]);
  });

  it("lists months by first day, crossing a year boundary", () => {
    const keys = bucketKeysInRange(
      { from: new Date("2026-11-15T00:00:00.000Z"), to: new Date("2027-02-03T00:00:00.000Z") },
      "month",
    );
    assert.deepEqual(keys, ["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01"]);
  });

  it("zeroFill puts a blank row in every empty bucket and keeps data rows", () => {
    const rows = zeroFill(range, "week", [{ key: "2026-09-07", n: 5 }], (key) => ({ key, n: 0 }));
    assert.deepEqual(rows, [
      { key: "2026-08-31", n: 0 },
      { key: "2026-09-07", n: 5 },
      { key: "2026-09-14", n: 0 },
    ]);
  });
});

describe("labels and defaults", () => {
  it("formats keys per bucket", () => {
    // ICU renders September as "Sep" or "Sept" depending on the Node build.
    assert.match(bucketLabel("2026-09-04", "day"), /^04 Sep\w*$/);
    assert.match(bucketLabel("2026-09-07", "week"), /^Wk of 07 Sep\w*$/);
    assert.match(bucketLabel("2026-09-01", "month"), /^Sep\w* 2026$/);
  });

  it("picks a granularity from the span", () => {
    assert.equal(defaultBucketFor(7), "day");
    assert.equal(defaultBucketFor(90), "week");
    assert.equal(defaultBucketFor(365), "month");
  });
});

describe("rollupCategoryPath", () => {
  it("rolls a nested path to its root and keeps the leaf intact", () => {
    assert.equal(rollupCategoryPath("/home-living/wall-decor", "root"), "/home-living");
    assert.equal(rollupCategoryPath("/home-living/wall-decor", "leaf"), "/home-living/wall-decor");
  });

  it("treats a root path as its own root and tolerates trailing slashes", () => {
    assert.equal(rollupCategoryPath("/gifts", "root"), "/gifts");
    assert.equal(rollupCategoryPath("/gifts/keychains/", "leaf"), "/gifts/keychains");
  });

  it("returns null for missing or empty snapshots", () => {
    assert.equal(rollupCategoryPath(null, "root"), null);
    assert.equal(rollupCategoryPath("", "leaf"), null);
    assert.equal(rollupCategoryPath("/", "root"), null);
  });

  it("humanizes slugs for deleted categories", () => {
    assert.equal(humanizeSlug("wall-decor"), "Wall decor");
  });
});
