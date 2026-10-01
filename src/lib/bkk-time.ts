// Canonical restaurant time. The store always runs on Asia/Bangkok, so every
// operational date key, hour bucket, range bound and displayed timestamp is
// computed here — never from the viewer's device timezone. Stored values stay
// UTC instants (timestamps) or plain YYYY-MM-DD keys (business_day).
import { bangkokDateKey, bangkokDayUtcBounds } from "@/lib/business-day";

export const BKK_TZ = "Asia/Bangkok";
export { bangkokDateKey, bangkokDayUtcBounds };

type Lang = "th" | "en" | string | undefined;
const loc = (lang: Lang) => (lang === "th" ? "th-TH" : lang && lang.includes("-") ? lang : "en-GB");
const toDate = (v: string | number | Date) => (v instanceof Date ? v : new Date(v));
const valid = (d: Date) => !Number.isNaN(d.getTime());

/** Today's Bangkok business date key (YYYY-MM-DD). */
export const bkkToday = (now = new Date()) => bangkokDateKey(now);

/** Bangkok YYYY-MM-DD for an instant. */
export function bkkDateKey(v: string | number | Date): string {
  return bangkokDateKey(toDate(v));
}

/** Bangkok hour of day 0–23 for an instant. */
export function bkkHour(v: string | number | Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: BKK_TZ, hour: "2-digit", hourCycle: "h23" })
    .formatToParts(toDate(v));
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
}

/** Add days to a YYYY-MM-DD key (pure calendar math, timezone-free). */
export function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Weekday of a YYYY-MM-DD key: 0 = Sunday … 6 = Saturday (timezone-free). */
export function weekdayOfKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Monday of the week containing the key (Mon–Sun weeks). */
export function mondayOfKey(key: string): string {
  return addDaysKey(key, -((weekdayOfKey(key) || 7) - 1));
}
export const monthStartKey = (key: string) => `${key.slice(0, 7)}-01`;
export const yearStartKey = (key: string) => `${key.slice(0, 4)}-01-01`;

/** UTC instants [start, end] covering Bangkok days fromKey..toKey inclusive. */
export function bkkRangeBounds(fromKey: string, toKey: string): [Date, Date] {
  const [start] = bangkokDayUtcBounds(fromKey);
  const [, nextStart] = bangkokDayUtcBounds(toKey);
  return [new Date(start), new Date(new Date(nextStart).getTime() - 1)];
}

export type CalRange = "today" | "yesterday" | "week" | "month" | "ytd";
/** Bangkok calendar range for a preset, as UTC instants. */
export function bkkPresetBounds(r: CalRange, now = new Date()): [Date, Date] {
  const today = bkkToday(now);
  if (r === "today") return bkkRangeBounds(today, today);
  if (r === "yesterday") { const y = addDaysKey(today, -1); return bkkRangeBounds(y, y); }
  if (r === "week") return bkkRangeBounds(mondayOfKey(today), today);
  if (r === "month") return bkkRangeBounds(monthStartKey(today), today);
  return bkkRangeBounds(yearStartKey(today), today);
}

/** Calendar-picker Date (device-local midnight of the tapped day) → YYYY-MM-DD.
 *  The picker cell represents a date label, not an instant, so local getters are
 *  correct here and the result is then treated as a Bangkok business date. */
export function pickerDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; // tz-safe: picker label
}
/** Bangkok UTC bounds for a picker selection. */
export function pickerBounds(from: Date, to?: Date): [Date, Date] {
  return bkkRangeBounds(pickerDateKey(from), pickerDateKey(to ?? from));
}

function fmt(v: string | number | Date | null | undefined, lang: Lang, opts: Intl.DateTimeFormatOptions): string {
  if (v === null || v === undefined || v === "") return "—";
  const d = toDate(v);
  if (!valid(d)) return "—";
  return new Intl.DateTimeFormat(loc(lang), { timeZone: BKK_TZ, ...opts }).format(d);
}
export const bkkTime = (v: string | number | Date | null | undefined, lang?: Lang, seconds = false) =>
  fmt(v, lang, { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hourCycle: "h23" });
export const bkkDate = (v: string | number | Date | null | undefined, lang?: Lang) =>
  fmt(v, lang, { day: "2-digit", month: "2-digit", year: "numeric" });
export const bkkDateTime = (v: string | number | Date | null | undefined, lang?: Lang) =>
  fmt(v, lang, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** Compact filename-safe Bangkok stamp, e.g. 2026-10-01_2205. */
export function bkkFileStamp(now = new Date()): string {
  const t = bkkTime(now, "en").replace(":", "");
  return `${bkkToday(now)}_${t}`;
}
/** Bangkok date/time parts for printers that format manually. */
export function bkkParts(v: string | number | Date) {
  const key = bkkDateKey(v);
  const [y, m, d] = key.split("-");
  return { y, m, d, time: bkkTime(v, "en") };
}
