import { describe, expect, test } from "bun:test";
import {
  addDaysKey, bkkDateKey, bkkDateTime, bkkHour, bkkPresetBounds, bkkRangeBounds, bkkTime,
  mondayOfKey, pickerBounds, weekdayOfKey,
} from "./bkk-time";
import { calculateKbankSettlement } from "./kbank-settlement";
import { inBucket } from "./qr-buckets";

// Run with TZ=Asia/Bangkok and TZ=America/New_York; every expectation is identical.
describe(`Bangkok time (device TZ=${process.env.TZ ?? "unset"})`, () => {
  test("Bangkok midnight boundary", () => {
    expect(bkkDateKey("2026-09-30T16:59:59Z")).toBe("2026-09-30"); // 23:59:59 BKK
    expect(bkkDateKey("2026-09-30T17:00:00Z")).toBe("2026-10-01"); // 00:00 BKK
    expect(bkkHour("2026-09-30T17:00:00Z")).toBe(0);
    expect(bkkHour("2026-10-01T08:00:00Z")).toBe(15);
    expect(bkkHour("2026-10-01T20:30:00Z")).toBe(3); // 03:30 next BKK day
    expect(bkkTime("2026-10-01T08:05:00Z", "en")).toBe("15:05");
    expect(bkkDateTime("2026-09-30T17:30:00Z", "en")).toBe("01/10/2026, 00:30");
  });

  test("Bangkok day bounds", () => {
    const [s, e] = bkkRangeBounds("2026-10-01", "2026-10-01");
    expect(s.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(e.toISOString()).toBe("2026-10-01T16:59:59.999Z");
  });

  test("week/month/year boundaries", () => {
    expect(weekdayOfKey("2026-10-01")).toBe(4); // Thursday
    expect(mondayOfKey("2026-10-04")).toBe("2026-09-28"); // Sunday → Monday
    expect(mondayOfKey("2026-09-28")).toBe("2026-09-28");
    expect(addDaysKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysKey("2028-03-01", -1)).toBe("2028-02-29");
    const now = new Date("2026-10-01T02:00:00Z"); // 09:00 BKK Thu, still Sep 30 in NY
    expect(bkkPresetBounds("today", now)[0].toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(bkkPresetBounds("week", now)[0].toISOString()).toBe("2026-09-27T17:00:00.000Z");
    expect(bkkPresetBounds("month", now)[0].toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(bkkPresetBounds("ytd", now)[0].toISOString()).toBe("2025-12-31T17:00:00.000Z");
  });

  test("America/New_York DST change does not shift Bangkok keys", () => {
    // NY falls back 2026-11-01 06:00Z; spring forward 2026-03-08 07:00Z.
    for (const iso of ["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z", "2026-03-08T06:30:00Z", "2026-03-08T07:30:00Z"]) {
      const h = (new Date(iso).getUTCHours() + 7) % 24;
      expect(bkkHour(iso)).toBe(h);
    }
    expect(bkkDateKey("2026-11-01T06:30:00Z")).toBe("2026-11-01");
  });

  test("calendar picker selection maps to the tapped Bangkok date", () => {
    const picked = new Date(2026, 9, 1); // device-local midnight of Oct 1
    const [s, e] = pickerBounds(picked);
    expect(s.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(e.toISOString()).toBe("2026-10-01T16:59:59.999Z");
  });

  test("KBank 23:00 cutoff and QR buckets stay Bangkok", () => {
    const r = calculateKbankSettlement(
      "2026-10-01",
      [{ amount: 100, created_at: "2026-09-30T15:59:59.000Z" }, { amount: 50, created_at: "2026-09-30T16:00:00.000Z" }],
      [{ amount: 20, created_at: "2026-10-01T15:59:00.000Z" }, { amount: 7, created_at: "2026-10-01T16:00:00.000Z" }],
    );
    expect(r).toEqual({ previousAfterCutoff: 50, currentBeforeCutoff: 20, expectedDeposit: 70 });
    expect(inBucket("2026-10-01T08:00:00Z", { start: "15:00", end: "18:00" })).toBe(true);
    expect(inBucket("2026-10-01T16:30:00Z", { start: "22:00", end: "02:00" })).toBe(true);
  });
});
