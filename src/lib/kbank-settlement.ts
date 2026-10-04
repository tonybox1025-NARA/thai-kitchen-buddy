export type TimedAmount = {
  amount: number | string | null;
  tip_amount?: number | string | null;
  created_at: string;
};

export function previousDateKey(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export function bangkokCutoffUtc(date: string): string {
  return new Date(`${date}T23:00:00+07:00`).toISOString();
}

const sumReceived = (rows: TimedAmount[]) =>
  Number(
    rows
      .reduce(
        (total, row) =>
          total + (Number(row.amount) || 0) + (Number(row.tip_amount) || 0),
        0,
      )
      .toFixed(2),
  );

/**
 * KBANK settles calendar date D as the previous business day's QR receipts
 * from 23:00 through close plus date D's QR receipts from open until 23:00.
 * Shift membership supplies the open/close edges; timestamps supply the 23:00
 * boundary. Exactly 23:00 belongs to the following settlement date.
 */
export function calculateKbankSettlement(
  date: string,
  previousBusinessDayQr: TimedAmount[],
  currentBusinessDayQr: TimedAmount[],
) {
  const previousCutoff = bangkokCutoffUtc(previousDateKey(date));
  const currentCutoff = bangkokCutoffUtc(date);
  const previousAfterCutoff = sumReceived(
    previousBusinessDayQr.filter((row) => row.created_at >= previousCutoff),
  );
  const currentBeforeCutoff = sumReceived(
    currentBusinessDayQr.filter((row) => row.created_at < currentCutoff),
  );

  return {
    previousAfterCutoff,
    currentBeforeCutoff,
    expectedDeposit: Number((previousAfterCutoff + currentBeforeCutoff).toFixed(2)),
  };
}
