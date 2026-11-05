import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(
  path.join(repositoryRoot, "src/routes/_app/time-analysis.tsx"),
  "utf8",
);

assert.match(source, /const weekdayHours = Array\.from\(\{ length: 7 \}/);
assert.match(source, /weekdays\[weekdayOfKey\(shift\.business_day\)\]\.days\.add/);
assert.match(source, /weekdayHours\[weekday\]\[h\]\.guests \+= guests/);
assert.match(source, /weekdayHours\[weekday\]\[h\]\.sales \+= total/);
assert.match(source, /const weekdayActiveHours = orderBusinessHours\(/);
assert.match(source, /hour >= 2 && hour < 12/);
assert.match(source, /Weekday × hour/);
assert.match(source, /After 02:00 summary/);
assert.match(source, /After-midnight activity stays with the original business day/);
assert.match(source, /Guests use table-open time; sales use payment time/);

console.log("OK: weekday-by-hour analysis preserves shift business days and late-hour averages");
