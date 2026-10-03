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
