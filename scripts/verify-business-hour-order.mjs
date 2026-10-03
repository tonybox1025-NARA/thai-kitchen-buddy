import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { orderBusinessHours } from "../src/lib/business-hour-order.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hours = (rows) => rows.map((row) => row.hour);

const afterMidnightFirst = [0, 1, 2, 3, 18, 19, 20, 21, 22, 23].map((hour) => ({ hour }));
assert.deepEqual(
  hours(orderBusinessHours(afterMidnightFirst)),
  [18, 19, 20, 21, 22, 23, 0, 1, 2, 3],
  "hourly reports must run from restaurant opening through the after-midnight close",
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

console.log("OK: hourly reports are protected in opening-to-close order");
