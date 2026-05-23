import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { thb } from "@/lib/format";
import { ArrowLeft } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { DashRangeBar } from "@/components/DashRangeBar";
import { type DashRange, rangeBounds, shiftIdsFor } from "@/lib/dash-range";

export const Route = createFileRoute("/_app/detail-gross")({
  component: GrossSalesDetail,
  validateSearch: (s: Record<string, unknown>) => ({ range: (s.range as DashRange | undefined) ?? "today" }),
});

type BillRow = {
  id: string; order_id: string; total: number; subtotal: number;
  discount_amount: number; paid_at: string | null;
};

function GrossSalesDetail() {
  const { range: initialRange } = Route.useSearch();
  const [range, setRange] = useState<DashRange>(initialRange);
  const [custom, setCustom] = useState<DateRange | undefined>();
  const [bills, setBills] = useState<BillRow[]>([]);
  const [tableMap, setTableMap] = useState<Map<string, string>>(new Map()); // bill_id → table_code
  const [loading, setLoading] = useState(false);

  const bounds = useMemo<[Date, Date]>(() => {
    if (range === "custom" && custom?.from) {
      const from = new Date(custom.from); from.setHours(0,0,0,0);
      const to   = new Date(custom.to ?? custom.from); to.setHours(23,59,59,999);
      return [from, to];
    }
    return rangeBounds(range === "custom" ? "today" : range);
  }, [range, custom]);

  useEffect(() => {
    if (range === "custom" && !custom?.from) return;
    setLoading(true);
    (async () => {
      try {
        const shiftIds = await shiftIdsFor(range, bounds);
        if (!shiftIds.length) { setBills([]); setTableMap(new Map()); return; }

        const { data: b } = await supabase.from("bills")
          .select("id,order_id,total,subtotal,discount_amount,paid_at")
          .eq("status","paid").in("shift_id", shiftIds)
          .order("paid_at", { ascending: false }).limit(500);
        if (!b?.length) { setBills([]); setTableMap(new Map()); return; }

        setBills(b as BillRow[]);

        const orderIds = [...new Set(b.map(x => x.order_id).filter(Boolean))] as string[];
        const { data: orders } = await supabase.from("orders").select("id,table_id,source,order_number").in("id", orderIds);
        const tableIds = [...new Set((orders ?? []).map(o => o.table_id).filter(Boolean))] as string[];
        const { data: tables } = tableIds.length
          ? await supabase.from("restaurant_tables").select("id,code").in("id", tableIds)
          : { data: [] as { id: string; code: string }[] };

        const tblMap = new Map((tables ?? []).map(t => [t.id, t.code]));
        const ordMap = new Map((orders ?? []).map(o => [o.id, { tableId: o.table_id as string | null, source: o.source as string, orderNumber: (o as any).order_number as string | null }]));
        const billToTable = new Map<string, string>();
        for (const bill of b) {
          const ord = ordMap.get(bill.order_id);
          if (!ord) { billToTable.set(bill.id, "—"); continue; }
          if (ord.source === "takeout")    { billToTable.set(bill.id, ord.orderNumber ?? "TO"); continue; }
          if (ord.source === "staff_meal") { billToTable.set(bill.id, ord.orderNumber ?? "ST"); continue; }
          billToTable.set(bill.id, ord.tableId ? (tblMap.get(ord.tableId) ?? "—") : "—");
        }
        setTableMap(billToTable);
      } finally { setLoading(false); }
    })();
  }, [bounds, range, custom]);

  const gross     = bills.reduce((s, b) => s + Number(b.subtotal), 0);
  const net       = bills.reduce((s, b) => s + Number(b.total), 0);
  const discounts = bills.reduce((s, b) => s + Number(b.discount_amount), 0);

  // By hour
  const byHour = useMemo(() => {
    const m = new Map<number, { count: number; total: number }>();
    for (const b of bills) {
      if (!b.paid_at) continue;
      const h = new Date(b.paid_at).getHours();
      const e = m.get(h) ?? { count: 0, total: 0 };
      e.count += 1; e.total += Number(b.total);
      m.set(h, e);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [bills]);

  // By table
  const byTable = useMemo(() => {
    const m = new Map<string, { count: number; total: number }>();
    for (const b of bills) {
      const code = tableMap.get(b.id) ?? "—";
      const e = m.get(code) ?? { count: 0, total: 0 };
      e.count += 1; e.total += Number(b.total);
      m.set(code, e);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [bills, tableMap]);

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link to="/dashboard"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Dashboard</Button></Link>
          <h1 className="text-xl font-bold">Gross Sales</h1>
        </div>
        <DashRangeBar range={range} onRange={setRange} custom={custom} onCustom={setCustom} />
      </div>

      {loading ? <p className="text-muted-foreground text-sm text-center py-8">Loading…</p> : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            {[["Gross", gross], ["Net", net], ["Discounts", discounts]].map(([l, v]) => (
              <Card key={l as string}>
                <CardContent className="pt-5">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{l as string}</p>
                  <p className="text-2xl font-bold mt-1">{thb(v as number)}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* By hour */}
          {byHour.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Sales by hour</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {byHour.map(([h, d]) => {
                    const pct = gross > 0 ? (d.total / gross) * 100 : 0;
                    const label = `${String(h).padStart(2,"0")}:00`;
                    return (
                      <div key={h} className="flex items-center gap-3 text-sm">
                        <span className="w-14 shrink-0 font-mono text-muted-foreground">{label}</span>
                        <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                          <div className="h-2 bg-primary rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-16 shrink-0 text-right tabular-nums">{thb(d.total)}</span>
                        <span className="w-12 shrink-0 text-right text-muted-foreground">{d.count} bill{d.count>1?"s":""}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* By table */}
          {byTable.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Sales by table / order</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-1 text-sm">
                  <div className="grid grid-cols-[3rem_1fr_5rem_4rem] gap-2 text-xs uppercase tracking-wide text-muted-foreground pb-1 border-b">
                    <span>Table</span><span></span><span className="text-right">Total</span><span className="text-right">Bills</span>
                  </div>
                  {byTable.map(([code, d]) => (
                    <div key={code} className="grid grid-cols-[3rem_1fr_5rem_4rem] gap-2 items-center py-0.5">
                      <span className="font-bold">{code}</span>
                      <div className="bg-muted rounded-full h-1.5 overflow-hidden">
                        <div className="h-1.5 bg-primary/60 rounded-full" style={{ width: `${gross>0?(d.total/gross)*100:0}%` }} />
                      </div>
                      <span className="text-right font-semibold tabular-nums">{thb(d.total)}</span>
                      <span className="text-right text-muted-foreground">{d.count}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* By order (all bills) */}
          <Card>
            <CardHeader><CardTitle className="text-base">All orders ({bills.length})</CardTitle></CardHeader>
            <CardContent>
              {bills.length === 0 ? (
                <p className="text-center text-muted-foreground py-6 text-sm">No paid bills for this period</p>
              ) : (
                <div className="space-y-1 text-sm">
                  <div className="grid grid-cols-[3rem_1fr_1fr_5rem] gap-2 text-xs uppercase tracking-wide text-muted-foreground pb-1 border-b">
                    <span>Table</span><span>Time</span><span>Discount</span><span className="text-right">Total</span>
                  </div>
                  {bills.map(b => (
                    <Link key={b.id} to="/payment/$billId" params={{ billId: b.id }}>
                      <div className="grid grid-cols-[3rem_1fr_1fr_5rem] gap-2 items-center py-1 hover:bg-muted/40 rounded px-1 transition-colors">
                        <span className="font-bold">{tableMap.get(b.id) ?? "—"}</span>
                        <span className="text-muted-foreground tabular-nums text-xs">
                          {b.paid_at ? new Date(b.paid_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) : "—"}
                        </span>
                        <span className="text-muted-foreground">
                          {Number(b.discount_amount) > 0 ? `- ${thb(Number(b.discount_amount))}` : "—"}
                        </span>
                        <span className="text-right font-semibold tabular-nums">{thb(Number(b.total))}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
