# Timezone audit (read-only) — viewing from Virginia (UTC-4) vs Bangkok (UTC+7)

No code, data or deployment changes were made. Findings are from the current source.

## Bottom line

- **Which sales are included in totals: mostly safe.** Dashboard, Bill History, Time analysis, the detail pages and Sales History pick records **by shift**. They don't use device-clock time ranges. Today/Yesterday use the open or latest shift. Week/Month/YTD are anchored to the shift's Bangkok open date. Sales History groups by the stored `business_day`. KBank cutoff and QR time buckets are pinned to Bangkok.
- **What is wrong from Virginia: hours and times shown (11 hours off), plus a few date edges.** The worst one is Time analysis "By hour": 15:00 Bangkok appears as 04:00. The other problems are times on screens and printouts, and the Loyalty audit date range.

## Findings

| Sev | File | Issue | Effect from Virginia |
|---|---|---|---|
| HIGH | `src/routes/_app/time-analysis.tsx:225,247` | `new Date(...).getHours()` buckets guests and sales by device hour | Hourly traffic and sales land in the wrong hours, and the business-hours rotation shifts with them. Totals are unchanged. |
| MED | `src/routes/_app/reports.tsx:1527-1557` (Loyalty audit) | `setHours(0)` / `setDate` on the device date, then filters `created_at >=` | Which ledger rows are included moves by about 11 hours |
| MED | `register.tsx:167,371` and `reports.tsx:200,468` | Print HTML uses `toLocaleString()` without a timezone | Opening slip and X/Z "Printed …" time shows Virginia time (business_day text stays correct) |
| MED | `register.tsx:616,756,964-965,1638-1639`, `reports.tsx:861,1836`, `detail-qr.tsx:161`, plus detail-*, payment, order, members, loyalty, settings, wallet, menu pages | `toLocaleTimeString/DateString` without `timeZone` | Paid, closed and opened times and dates shown in Virginia time. A late-night bill can show the previous date. |
| LOW | `src/lib/dash-range.ts:41-51 rangeBounds`, `register.tsx:818-845 histBounds`, `reports.tsx:1690-1712`, `dashboard.tsx:27-31`, `time-analysis.tsx:103-112` | Range bounds come from the device's local midnight | Unused for non-custom ranges, because `shiftIdsFor` ignores them. It's dead risk, but misleading code. |
| LOW | `dash-range.ts:79-81` custom range | `localDateKey(picker date)` | Safe in practice: the calendar returns the day you tapped, then it is mapped to Bangkok shift open bounds |
| LOW | `reports.tsx:1617`, `crew.tsx:304` | ISO date in a filename, `now` used as a timestamp | Cosmetic only: a UTC date in the CSV filename |
| INFO | `live.tsx:325` | "Updated hh:mm:ss" in device time | Refresh indicator only |

## Already safe (keep)

- `src/lib/business-day.ts`: `bangkokDateKey` and `bangkokDayUtcBounds` (Intl with `Asia/Bangkok` and `+07:00` bounds)
- `src/lib/dash-range.ts shiftIdsFor`: shift-based ranges. Calendar ranges use Bangkok `opened_at` bounds. Weekday math works on local-noon dates built from Bangkok date keys, so it is safe.
- Shift open (`reports.tsx:521` `bangkokDateKey()` → `open_shift_safely`), shift close (`lib/shift-close.ts`), and Z dates shown via `bangkokDateKey(opened_at)` or the stored `business_day`
- `src/lib/kbank-settlement.ts`: 23:00 cutoff with `+07:00` in UTC ISO strings
- `src/lib/qr-buckets.ts`: Bangkok time of day through Intl
- Sales History period keys (`reports.tsx:982-998`): pure UTC math on `business_day`
- `time-analysis.tsx:234,254` weekday from `${business_day}T12:00:00`: no day flip within ±12h
- `live.tsx:49-60`: already pinned to `Asia/Bangkok`
- Order and payment timestamps are written by the database (`now()`) or via `toISOString()` in UTC, so stored data does not depend on the device

## Not fully verified

- Attendance and payroll: the `crew.tsx` attendance views and the `attendance-live-summary` function showed no device-local date math in the search, but I did not read them line by line.
- Server routes `api/public/daily-summary.$date.ts` and `item-sales.$date.ts` use `bangkokDayUtcBounds`, which is safe, but I only skimmed them.

## Recommended single fix strategy (for a later, separate change)

1. Add one module `src/lib/bkk-time.ts`: `BKK_TZ = "Asia/Bangkok"`, `bkkHour(iso)`, `bkkTime(iso, lang)`, `bkkDate(iso, lang)`, `bkkDateTime(iso, lang)`, and `bkkToday()` (re-export of `bangkokDateKey`). All of them use Intl with `timeZone: BKK_TZ`.
2. Replace every operational `getHours()`, `toLocale*String()` and `setHours`-based bound with these helpers. Start with Time analysis hourly, then the Loyalty audit start (`bangkokDayUtcBounds(addDays(bkkToday(), -N))[0]`), then print HTML, then the list displays.
3. Delete the unused `rangeBounds` and `histBounds` results from shift-based flows, so ranges come only from `shiftIdsFor`.
4. Add a lint/verify script, like `verify-no-direct-print.sh`, that fails on `getHours(`, `setHours(` or `toLocale(Date|Time)?String(` without `timeZone` in `src/routes` and `src/lib`.
5. Test: run typecheck and build, then run Playwright with `timezoneId: "America/New_York"` and with `"Asia/Bangkok"`. The Dashboard, Time analysis, Bill History, Sales History and Z screens should give identical text and totals.

Stored UTC timestamps and existing `business_day` values stay unchanged.
