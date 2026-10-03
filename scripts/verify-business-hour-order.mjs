import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { groupBusinessEvents, orderBusinessHours } from "../src/lib/business-hour-order.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hours = (rows) => rows.map((row) => row.hour);

const afterMidnightFirst = [0, 1, 2, 3, 18, 19, 20, 21, 22, 23].map((hour) => ({ hour }));
assert.deepEqual(
  hours(orderBusinessHours(afterMidnightFirst)),
  [18, 19, 20, 21, 22, 23, 0, 1, 2, 3],
  "hourly reports must run from restaurant opening through the after-midnight close",
);

const grouped = groupBusinessEvents(
  [
    { day: "2026-09-02", at: "2026-09-02T19:00:00+07:00", id: "d2-open" },
    { day: "2026-09-01", at: "2026-09-02T02:00:00+07:00", id: "d1-close" },
    { day: "2026-09-01", at: "2026-09-01T18:00:00+07:00", id: "d1-open" },
  ],
  (row) => row.day,
  (row) => row.at,
);
assert.deepEqual(
  grouped.map((group) => [group.businessDay, group.rows.map((row) => row.id)]),
  [
    ["2026-09-01", ["d1-open", "d1-close"]],
    ["2026-09-02", ["d2-open"]],
  ],
  "multi-day details must preserve business-day boundaries and opening-to-close order",
);

assert.deepEqual(
  hours(
    orderBusinessHours(
      [0, 15, 23, 1].map((hour) => ({ hour })),
      15,
    ),
  ),
  [15, 23, 0, 1],
  "an explicit shift opening hour must be respected",
);

assert.deepEqual(
  hours(afterMidnightFirst),
  [0, 1, 2, 3, 18, 19, 20, 21, 22, 23],
  "the shared ordering helper must not mutate report data",
);

const protectedScreens = [
  "src/routes/_app/detail-gross.tsx",
  "src/routes/_app/time-analysis.tsx",
  "src/routes/_app/live.tsx",
];

for (const relativePath of protectedScreens) {
  const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
  assert.match(
    source,
    /from ["']@\/lib\/business-hour-order["']/,
    `${relativePath} must import the shared business-hour ordering rule`,
  );
  assert.match(
    source,
    /orderBusinessHours\(/,
    `${relativePath} must use the shared business-hour ordering rule`,
  );
}

const groupedDetailScreens = [
  "src/routes/_app/detail-gross.tsx",
  "src/routes/_app/detail-qr.tsx",
  "src/routes/_app/detail-tips.tsx",
  "src/routes/_app/detail-discounts.tsx",
  "src/routes/_app/detail-voids.tsx",
];

for (const relativePath of groupedDetailScreens) {
  const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
  assert.match(source, /groupBusinessEvents\(/, `${relativePath} must group records by business day`);
  assert.match(source, /t\("business_day"\)/, `${relativePath} must show the business day label`);
}

console.log("OK: hourly and multi-day reports are protected in business-day opening-to-close order");
