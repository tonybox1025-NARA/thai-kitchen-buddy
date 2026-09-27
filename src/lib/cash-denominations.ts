export const CASH_BILLS = [1000, 500, 100, 50, 20] as const;
export const CASH_COINS = [10, 5, 2, 1, 0.5, 0.25] as const;
export const CASH_DENOMINATIONS = [...CASH_BILLS, ...CASH_COINS] as const;

export type CashCount = Record<number, number>;

export function normalizeCashCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function totalCashCount(value: unknown): number | null {
  if (value == null || Array.isArray(value) || typeof value !== "object") return null;

  return Object.entries(value as Record<string, unknown>).reduce((total, [denomination, count]) => {
    const denominationValue = Number(denomination);
    const countValue = Number(count);
    if (!Number.isFinite(denominationValue) || !Number.isFinite(countValue)) return total;
    return total + denominationValue * normalizeCashCount(countValue);
  }, 0);
}

type ClosedShiftCash = {
  status: string;
  opening_float: number | string | null;
  cash_count: unknown;
};

/**
 * Returns the physical drawer total less its opening float for a fully closed
 * business day. A missing/open shift returns null so Manager never silently
 * imports zero in place of an unfinished Z count.
 */
export function countedCashAfterOpening(shifts: ClosedShiftCash[]): number | null {
  if (shifts.length === 0 || shifts.some((shift) => shift.status !== "closed")) return null;

  let counted = 0;
  let opening = 0;
  for (const shift of shifts) {
    const shiftCount = totalCashCount(shift.cash_count);
    if (shiftCount == null) return null;
    counted += shiftCount;
    opening += Number(shift.opening_float) || 0;
  }
  return Number((counted - opening).toFixed(2));
}
