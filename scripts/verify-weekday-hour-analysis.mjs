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
assert.match(source, /const \[summaryStartHour, setSummaryStartHour\] = useState\(2\)/);
assert.match(source, /const \[summaryEndHour, setSummaryEndHour\] = useState\(11\)/);
assert.match(source, /summaryStartHour <= summaryEndHour/);
assert.match(source, /hour >= summaryStartHour \|\| hour <= summaryEndHour/);
assert.match(source, /Summary start hour/);
assert.match(source, /Summary end hour/);
assert.match(source, /const weekdayDisplayOrder = \[1, 2, 3, 4, 5, 6, 0\]/);
assert.match(source, /weekdayDisplayOrder\.map\(\(weekdayIndex\) =>/);
assert.match(source, /Time total/);
assert.match(source, /analysis\.weekdayHours\.reduce/);
assert.match(source, /Weekday × hour/);
assert.match(source, /summaryRangeLabel/);
assert.match(source, /After-midnight activity stays with the original business day/);
assert.match(source, /Guests use table-open time; sales use payment time/);
assert.match(source, /const \[selectedMonth, setSelectedMonth\] = useState\(currentMonthKey\)/);
assert.match(source, /if \(range === "month"\) return monthBounds\(selectedMonth\)/);
assert.match(source, /shiftIdsFor\(range === "month" \? "custom" : range, bounds\)/);
assert.match(source, /type="month"/);
assert.match(source, /max=\{currentMonth\}/);
assert.match(source, /event\.target\.value > currentMonth \? currentMonth : event\.target\.value/);
assert.match(source, /Month shown/);
assert.match(source, /Previous month/);
assert.match(source, /Next month/);

console.log("OK: weekday-by-hour analysis preserves shift business days and late-hour averages");
