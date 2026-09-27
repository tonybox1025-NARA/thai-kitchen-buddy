import { useI18n } from "@/lib/i18n";
import { thb } from "@/lib/format";
import {
  CASH_BILLS,
  CASH_COINS,
  normalizeCashCount,
  type CashCount,
} from "@/lib/cash-denominations";

export function CashDenominationGrid({
  cashCount,
  onChange,
}: {
  cashCount: CashCount;
  onChange: (cashCount: CashCount) => void;
}) {
  const { t } = useI18n();
  const label = (denomination: number) =>
    denomination < 1 ? `${denomination.toFixed(2)}฿` : `${denomination}฿`;

  const cell = (denomination: number) => {
    const count = cashCount[denomination] ?? 0;
    const setCount = (next: number) => {
      onChange({ ...cashCount, [denomination]: normalizeCashCount(next) });
    };

    return (
      <div key={denomination} className="rounded-xl border bg-card p-3">
        <div className="mb-2 text-sm font-semibold text-muted-foreground">
          {label(denomination)}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCount(count - 1)}
            aria-label={`${label(denomination)} minus one`}
            className="flex h-12 w-12 flex-shrink-0 select-none items-center justify-center rounded-lg border bg-muted text-2xl font-bold transition-all hover:bg-accent active:scale-95"
          >
            −
          </button>
          <input
            type="number"
            inputMode="numeric"
            pattern="[0-9]*"
            min={0}
            max={99999}
            step={1}
            value={count}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setCount(Number(event.currentTarget.value || 0))}
            aria-label={`${label(denomination)} quantity`}
            className="h-12 min-w-0 flex-1 rounded-lg border-2 border-primary/60 bg-primary/5 px-1 text-center text-2xl font-bold tabular-nums outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
          <button
            type="button"
            onClick={() => setCount(count + 1)}
            aria-label={`${label(denomination)} plus one`}
            className="flex h-12 w-12 flex-shrink-0 select-none items-center justify-center rounded-lg border bg-muted text-2xl font-bold transition-all hover:bg-accent active:scale-95"
          >
            +
          </button>
        </div>
        <div className="mt-1.5 text-center text-xs text-muted-foreground">
          {count > 0 ? thb(count * denomination) : "—"}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          💵 {t("denom_bills")}
        </p>
        <div className="grid grid-cols-2 gap-3">{CASH_BILLS.map(cell)}</div>
      </div>
      <div className="border-t pt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          🪙 {t("denom_coins")}
        </p>
        <div className="grid grid-cols-2 gap-3">{CASH_COINS.map(cell)}</div>
      </div>
    </div>
  );
}
