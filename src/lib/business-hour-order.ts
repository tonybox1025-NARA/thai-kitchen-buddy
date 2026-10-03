/**
 * Put active hour buckets in restaurant operating order instead of clock order.
 *
 * Without an explicit shift opening hour, the first bucket after the largest
 * inactive gap is treated as opening. For example, 18..23,00..03 stays in that
 * order rather than being displayed as 00..03,18..23.
 */
export function orderBusinessHours<T extends { hour: number }>(
  rows: T[],
  shiftOpenHour?: number,
): T[] {
  if (rows.length < 2) return [...rows];

  if (shiftOpenHour !== undefined) {
    const opening = ((shiftOpenHour % 24) + 24) % 24;
    return [...rows].sort(
      (a, b) => ((a.hour - opening + 24) % 24) - ((b.hour - opening + 24) % 24),
    );
  }

  const sorted = [...rows].sort((a, b) => a.hour - b.hour);
  let bestStart = 0;
  let bestGap = -1;

  for (let i = 0; i < sorted.length; i++) {
    const previousHour = sorted[(i - 1 + sorted.length) % sorted.length].hour;
    const gap = (sorted[i].hour - previousHour + 24) % 24 || 24;
    if (gap > bestGap) {
      bestGap = gap;
      bestStart = i;
    }
  }

  return [...sorted.slice(bestStart), ...sorted.slice(0, bestStart)];
}

/** Sort business-flow records from opening toward close, including after midnight. */
export function orderBusinessEvents<T>(
  rows: T[],
  timestampOf: (row: T) => string | null | undefined,
): T[] {
  const timestamp = (row: T) => {
    const value = timestampOf(row);
    if (!value) return Number.POSITIVE_INFINITY;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
  };

  return [...rows].sort((a, b) => timestamp(a) - timestamp(b));
}

export type BusinessDayGroup<T> = { businessDay: string; rows: T[] };

/**
 * Keep multi-day operational lists readable: business days run oldest to newest,
 * while records inside each shift run from opening toward close.
 */
export function groupBusinessEvents<T>(
  rows: T[],
  businessDayOf: (row: T) => string | null | undefined,
  timestampOf: (row: T) => string | null | undefined,
): BusinessDayGroup<T>[] {
  const byDay = new Map<string, T[]>();
  for (const row of rows) {
    const day = businessDayOf(row) || "unknown";
    const group = byDay.get(day) ?? [];
    group.push(row);
    byDay.set(day, group);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([businessDay, dayRows]) => ({
      businessDay,
      rows: orderBusinessEvents(dayRows, timestampOf),
    }));
}
