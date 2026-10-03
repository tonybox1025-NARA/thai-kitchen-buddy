import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { advanceDateRange } from "../src/lib/date-range-selection.ts";

const start = new Date("2026-10-03T00:00:00+07:00");
const end = new Date("2026-10-08T00:00:00+07:00");
const first = advanceDateRange(undefined, start);
assert.equal(first.complete, false, "the first range click must not apply or close the picker");
assert.equal(first.range.from?.getTime(), start.getTime());
assert.equal(first.range.to, undefined);

const second = advanceDateRange(start, end);
assert.equal(second.complete, true, "the second range click must complete the range");
assert.equal(second.range.from?.getTime(), start.getTime());
assert.equal(second.range.to?.getTime(), end.getTime());

const reverse = advanceDateRange(end, start);
assert.equal(reverse.range.from?.getTime(), start.getTime());
assert.equal(reverse.range.to?.getTime(), end.getTime());

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pickerSource = await readFile(
  path.join(repositoryRoot, "src/components/DashRangeBar.tsx"),
  "utf8",
);
assert.match(pickerSource, /advanceDateRange\(rangeStart, clicked\)/);
assert.match(pickerSource, /if \(!step\.complete\)/);
assert.match(
  pickerSource,
  /useState<"single" \| "range">\("range"\)/,
  "the custom picker must open in date-range mode by default",
);
assert.match(
  pickerSource,
  /onDayClick=\{\(clicked\) =>/,
  "range selection must be driven by deliberate day clicks",
);

const historyPickerSource = await readFile(
  path.join(repositoryRoot, "src/components/HistoryRangeBar.tsx"),
  "utf8",
);
assert.match(historyPickerSource, /advanceDateRange\(rangeStart, clicked\)/);
assert.match(historyPickerSource, /if \(!step\.complete\)/);
assert.match(historyPickerSource, /onDayClick=\{\(clicked\) =>/);

for (const [relativePath, minimumSharedPickers] of [
  ["src/routes/_app/reports.tsx", 6],
  ["src/routes/_app/register.tsx", 3],
]) {
  const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
  assert.doesNotMatch(
    source,
    /<Calendar[^>]*mode="range"/,
    `${relativePath} must use the protected shared history date-range picker`,
  );
  const sharedPickerCount = source.match(/<HistoryRangeBar\b/g)?.length ?? 0;
  assert.ok(
    sharedPickerCount >= minimumSharedPickers,
    `${relativePath} must keep every report history screen on the shared range bar`,
  );
}

console.log("OK: dashboard and report date ranges wait for a deliberate second date click");
