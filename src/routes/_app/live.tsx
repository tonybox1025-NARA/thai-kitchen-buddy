import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { thb } from "@/lib/format";
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
  const [tables, setTables] = useState<RTable[]>([]);
  const [openedAt, setOpenedAt] = useState<Map<string, string>>(new Map());
  const [byMethod, setByMethod] = useState<Record<string, number>>({ cash: 0, qr: 0, gov_qr: 0, card: 0 });
  const [salesNet, setSalesNet] = useState(0);
  const [billCount, setBillCount] = useState(0);
  const [hasShift, setHasShift] = useState(true);
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
      const { data: bills } = await supabase.from("bills").select("id,total").eq("status", "paid").eq("shift_id", shift.id);
      const ids = (bills ?? []).map((b) => b.id);
      setBillCount((bills ?? []).length);
      setSalesNet((bills ?? []).reduce((s, b) => s + Number(b.total), 0));
      const { data: pays } = ids.length
        ? await supabase.from("payments").select("method,amount").in("bill_id", ids)
        : { data: [] as { method: string; amount: number }[] };
      const m: Record<string, number> = { cash: 0, qr: 0, gov_qr: 0, card: 0 };
      for (const p of pays ?? []) m[p.method] = (m[p.method] ?? 0) + Number(p.amount);
      setByMethod(m);
    } else {
      setBillCount(0); setSalesNet(0); setByMethod({ cash: 0, qr: 0, gov_qr: 0, card: 0 });
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
          <h1 className="text-2xl font-bold">Live</h1>
          <p className="text-xs text-muted-foreground">
            Updated {updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </p>
        </div>
        <button onClick={() => void load()} className="rounded-full border p-2 active:scale-95 transition-transform" aria-label="Refresh">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Occupancy + sales headline */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground"><Utensils className="h-3.5 w-3.5" />Tables in use</div>
            <div className="mt-1 text-3xl font-black tabular-nums">{occupied}<span className="text-lg font-semibold text-muted-foreground">/{total}</span></div>
            <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${occPct}%` }} />
            </div>
            <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" />{seatedGuests} guests seated</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground"><Receipt className="h-3.5 w-3.5" />Sales today</div>
            <div className="mt-1 text-3xl font-black tabular-nums">{thb(salesNet)}</div>
            <div className="mt-2 text-xs text-muted-foreground tabular-nums">{billCount} bills · avg {thb(avgBill)}</div>
            {!hasShift && <div className="mt-1 text-xs text-amber-600">No shift open yet today</div>}
          </CardContent>
        </Card>
      </div>

      {/* Payment split */}
      {salesNet > 0 && (
        <Card>
          <CardContent className="p-3 grid grid-cols-4 gap-2 text-center">
            {[["Cash", byMethod.cash], ["QR", byMethod.qr], ["Card", byMethod.card], ["Gov QR", byMethod.gov_qr]].map(([label, val]) => (
              <div key={label as string}>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
                <div className="text-sm font-bold tabular-nums">{thb(Number(val))}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Active tables */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Active tables</h2>
          {billRequested > 0 && <Badge variant="destructive">{billRequested} bill requested</Badge>}
        </div>
        {active.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">All tables free right now 🍃</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {active.map((t) => (
              <Card key={t.id} className={t.status === "bill_requested" ? "border-destructive/50" : ""}>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="grid h-11 w-11 flex-none place-items-center rounded-lg bg-primary/10 text-lg font-bold text-primary">{t.code}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Table {t.code}</span>
                      {t.status === "bill_requested" && <Badge variant="destructive" className="text-[10px]">Bill requested</Badge>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                      <span className="flex items-center gap-1"><Users className="h-3 w-3" />{t.guests || "?"}</span>
                      {t.minutes > 0 && <span>· {fmtDuration(t.minutes)}</span>}
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
