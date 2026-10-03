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

console.log("OK: date ranges wait for a deliberate second date click");
