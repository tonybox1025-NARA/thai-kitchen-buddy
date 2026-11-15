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
assert.match(source, /summaryStartHour <= summaryEndHour/);
assert.match(source, /hour >= summaryStartHour \|\| hour <= summaryEndHour/);
assert.match(source, /Start hour/);
assert.match(source, /End hour/);
// The From/Through range now filters the whole matrix (not just a summary block).
assert.match(source, /const matrixHours = summaryHours/);
assert.match(source, /const \[rangeTouched, setRangeTouched\]/);
assert.match(source, /const \[heatMetric, setHeatMetric\]/);
assert.match(source, /const weekdayDisplayOrder = \[1, 2, 3, 4, 5, 6, 0\]/);
assert.match(source, /weekdayDisplayOrder\.map\(\(weekdayIndex\) =>/);
assert.match(source, /Time total/);
// Footer totals sum the actual per-weekday hour values (no per-day averaging).
assert.match(source, /analysis\.weekdayHours\[wd\]\[hour\]/);
assert.match(source, /Weekday × hour/);
assert.match(source, /After-midnight activity stays with the original business day/);
assert.match(source, /Guests use table-open time, sales use payment time/);
// Cells and the Totals-by-weekday card must show ACTUAL totals, never a per-day average.
assert.doesNotMatch(source, /\.guests \/ days/);
assert.doesNotMatch(source, /\.sales \/ days/);
assert.doesNotMatch(source, /guests\/day/);
assert.match(source, /const \[selectedMonth, setSelectedMonth\] = useState\(currentMonthKey\)/);
assert.match(source, /if \(range === "month"\) return monthBounds\(selectedMonth\)/);
assert.match(source, /range === "month" \|\| range === "week" \? "custom" : range/);
assert.match(source, /type="month"/);
assert.match(source, /max=\{currentMonth\}/);
assert.match(source, /event\.target\.value > currentMonth \? currentMonth : event\.target\.value/);
assert.match(source, /Month shown/);
assert.match(source, /Previous month/);
assert.match(source, /Next month/);
// Week picker: choose which specific week (Monday..Sunday), with "this week" guard.
assert.match(source, /const \[selectedWeek, setSelectedWeek\] = useState\(currentWeekKey\)/);
assert.match(source, /if \(range === "week"\) return weekBounds\(selectedWeek\)/);
assert.match(source, /const weekBounds = \(mondayKey: string\)/);
assert.match(source, /Previous week/);
assert.match(source, /Next week/);
assert.match(source, /disabled=\{selectedWeek >= currentWeek\}/);
// Controls stay pinned while the table scrolls.
assert.match(source, /sticky top-14/);

console.log(
  "OK: weekday-by-hour analysis preserves shift business days and shows actual totals (reconciling rows/columns)",
);
