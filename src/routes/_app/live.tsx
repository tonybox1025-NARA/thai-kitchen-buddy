import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { thb } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { RefreshCw, Users, Utensils, Receipt } from "lucide-react";

export const Route = createFileRoute("/_app/live")({ component: LivePage });

type RTable = {
  id: string; code: string; capacity: number;
  status: "available" | "occupied" | "bill_requested";
  guests: number;
};
type OpenOrder = { table_id: string | null; opened_at: string };

function minutesSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}
function fmtDuration(min: number): string {
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function LivePage() {
  const { t, lang } = useI18n();
  const [tables, setTables] = useState<RTable[]>([]);
  const [openedAt, setOpenedAt] = useState<Map<string, string>>(new Map());
  const [byMethod, setByMethod] = useState<Record<string, number>>({ cash: 0, qr: 0, gov_qr: 0, card: 0 });
  const [salesNet, setSalesNet] = useState(0);
  const [billCount, setBillCount] = useState(0);
  const [hasShift, setHasShift] = useState(true);
  const [hourly, setHourly] = useState<{ hour: number; count: number; total: number }[]>([]);
  const [topItems, setTopItems] = useState<{ name_th: string; name_en: string; qty: number }[]>([]);
  const [updatedAt, setUpdatedAt] = useState<Date>(new Date());
  const [loading, setLoading] = useState(true);

  const load = async () => {
    // Tables + open orders (for how long each table has been seated)
    const [{ data: tbls }, { data: openOrders }, { data: shift }] = await Promise.all([
      supabase.from("restaurant_tables").select("id,code,capacity,status,guests").order("code"),
      supabase.from("orders").select("table_id,opened_at").eq("status", "open").not("table_id", "is", null),
      supabase.from("shifts").select("id").eq("status", "open").maybeSingle(),
    ]);
    setTables((tbls ?? []) as RTable[]);
    const map = new Map<string, string>();
    for (const o of (openOrders ?? []) as OpenOrder[]) {
      if (o.table_id && (!map.has(o.table_id) || o.opened_at < map.get(o.table_id)!)) map.set(o.table_id, o.opened_at);
    }
    setOpenedAt(map);

    // Today's paid sales for the open shift
    setHasShift(!!shift);
    if (shift?.id) {
      const { data: bills } = await supabase.from("bills").select("id,total,paid_at").eq("status", "paid").eq("shift_id", shift.id);
      const ids = (bills ?? []).map((b) => b.id);
      setBillCount((bills ?? []).length);
      setSalesNet((bills ?? []).reduce((s, b) => s + Number(b.total), 0));

      // Hourly customer flow (by bill paid_at, local hour)
      const hMap = new Map<number, { count: number; total: number }>();
      for (const b of (bills ?? []) as { total: number; paid_at: string | null }[]) {
        if (!b.paid_at) continue;
        const h = new Date(b.paid_at).getHours();
        const cur = hMap.get(h) ?? { count: 0, total: 0 };
        cur.count += 1; cur.total += Number(b.total);
        hMap.set(h, cur);
      }
      setHourly([...hMap.entries()].map(([hour, v]) => ({ hour, ...v })).sort((a, b) => a.hour - b.hour));

      const [{ data: pays }, { data: shiftOrders }] = await Promise.all([
        ids.length
          ? supabase.from("payments").select("method,amount").in("bill_id", ids)
          : Promise.resolve({ data: [] as { method: string; amount: number }[] }),
        supabase.from("orders").select("id").eq("shift_id", shift.id),
      ]);
      const m: Record<string, number> = { cash: 0, qr: 0, gov_qr: 0, card: 0 };
      for (const p of pays ?? []) m[p.method] = (m[p.method] ?? 0) + Number(p.amount);
      setByMethod(m);

      // Top items today (all non-voided order items in this shift)
      const orderIds = (shiftOrders ?? []).map((o: { id: string }) => o.id);
      const { data: oi } = orderIds.length
        ? await (supabase as any).from("order_items").select("name_th,name_en,qty,voided_at").in("order_id", orderIds).is("voided_at", null)
        : { data: [] as { name_th: string; name_en: string; qty: number }[] };
      const iMap = new Map<string, { name_th: string; name_en: string; qty: number }>();
      for (const it of (oi ?? []) as { name_th: string; name_en: string; qty: number }[]) {
        const key = it.name_en || it.name_th || "Item";
        const cur = iMap.get(key) ?? { name_th: it.name_th, name_en: it.name_en, qty: 0 };
        cur.qty += Number(it.qty);
        iMap.set(key, cur);
      }
      setTopItems([...iMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 5));
    } else {
      setBillCount(0); setSalesNet(0); setByMethod({ cash: 0, qr: 0, gov_qr: 0, card: 0 });
      setHourly([]); setTopItems([]);
    }
    setUpdatedAt(new Date());
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("live-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_tables" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "bills" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => void load())
      .subscribe();
    const poll = setInterval(() => void load(), 20000); // refresh durations + safety net
    return () => { supabase.removeChannel(ch); clearInterval(poll); };
  }, []);

  const active = useMemo(
    () => tables
      .filter((t) => t.status !== "available")
      .map((t) => ({ ...t, minutes: openedAt.has(t.id) ? minutesSince(openedAt.get(t.id)!) : 0 }))
      .sort((a, b) => (b.status === "bill_requested" ? 1 : 0) - (a.status === "bill_requested" ? 1 : 0) || b.minutes - a.minutes),
    [tables, openedAt],
  );
  const occupied = active.length;
  const total = tables.length;
  const seatedGuests = active.reduce((s, t) => s + (t.guests || 0), 0);
  const billRequested = active.filter((t) => t.status === "bill_requested").length;
  const occPct = total > 0 ? Math.round((occupied / total) * 100) : 0;
  const avgBill = billCount > 0 ? salesNet / billCount : 0;

  return (
    <div className="mx-auto max-w-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("live_title")}</h1>
          <p className="text-xs text-muted-foreground">
            {t("live_updated")} {updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </p>
        </div>
        <button onClick={() => void load()} className="rounded-full border p-2 active:scale-95 transition-transform" aria-label={t("live_refresh")}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Occupancy + sales headline */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground"><Utensils className="h-3.5 w-3.5" />{t("live_tables_in_use")}</div>
            <div className="mt-1 text-3xl font-black tabular-nums">{occupied}<span className="text-lg font-semibold text-muted-foreground">/{total}</span></div>
            <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${occPct}%` }} />
            </div>
            <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" />{seatedGuests} {t("live_guests_seated")}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground"><Receipt className="h-3.5 w-3.5" />{t("live_sales_today")}</div>
            <div className="mt-1 text-3xl font-black tabular-nums">{thb(salesNet)}</div>
            <div className="mt-2 text-xs text-muted-foreground tabular-nums">{billCount} {t("live_bills")} · {t("live_avg")} {thb(avgBill)}</div>
            {!hasShift && <div className="mt-1 text-xs text-amber-600">{t("live_no_shift")}</div>}
          </CardContent>
        </Card>
      </div>

      {/* Payment split */}
      {salesNet > 0 && (
        <Card>
          <CardContent className="p-3 grid grid-cols-4 gap-2 text-center">
            {[[t("pm_cash"), byMethod.cash], [t("pm_qr"), byMethod.qr], [t("pm_card"), byMethod.card], [t("pm_gov_qr"), byMethod.gov_qr]].map(([label, val]) => (
              <div key={label as string}>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
                <div className="text-sm font-bold tabular-nums">{thb(Number(val))}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Busy hours today */}
      {hourly.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold">{t("live_busy_hours")}</h2>
          <Card>
            <CardContent className="p-3 space-y-1.5">
              {(() => {
                const max = Math.max(...hourly.map((h) => h.count), 1);
                return hourly.map((h) => (
                  <div key={h.hour} className="flex items-center gap-2 text-xs">
                    <span className="w-10 flex-none tabular-nums text-muted-foreground">{String(h.hour).padStart(2, "0")}:00</span>
                    <div className="h-4 flex-1 rounded bg-muted overflow-hidden">
                      <div className="h-full rounded bg-primary/70" style={{ width: `${(h.count / max) * 100}%` }} />
                    </div>
                    <span className="w-24 flex-none text-right tabular-nums">{h.count} {t("live_bills")} · {thb(h.total)}</span>
                  </div>
                ));
              })()}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Top items today */}
      {topItems.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold">{t("live_top_items")}</h2>
          <Card>
            <CardContent className="p-2">
              {topItems.map((it, i) => (
                <div key={it.name_en || it.name_th} className="flex items-center gap-3 px-1 py-1.5">
                  <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{lang === "th" ? (it.name_th || it.name_en) : (it.name_en || it.name_th)}</span>
                  <span className="flex-none text-sm font-bold tabular-nums">×{it.qty}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Active tables */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("live_active_tables")}</h2>
          {billRequested > 0 && <Badge variant="destructive">{billRequested} {t("live_bill_requested")}</Badge>}
        </div>
        {active.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">{t("live_all_free")}</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {active.map((tbl) => (
              <Card key={tbl.id} className={tbl.status === "bill_requested" ? "border-destructive/50" : ""}>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="grid h-11 w-11 flex-none place-items-center rounded-lg bg-primary/10 text-lg font-bold text-primary">{tbl.code}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{t("table")} {tbl.code}</span>
                      {tbl.status === "bill_requested" && <Badge variant="destructive" className="text-[10px]">{t("bill_requested")}</Badge>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                      <span className="flex items-center gap-1"><Users className="h-3 w-3" />{tbl.guests || "?"}</span>
                      {tbl.minutes > 0 && <span>· {fmtDuration(tbl.minutes)}</span>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
