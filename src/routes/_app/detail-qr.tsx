import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { thb } from "@/lib/format";
import { ArrowLeft, QrCode } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { DashRangeBar } from "@/components/DashRangeBar";
import { type DashRange, rangeBounds, shiftIdsFor } from "@/lib/dash-range";

export const Route = createFileRoute("/_app/detail-qr")({
  component: QrSalesDetail,
  validateSearch: (s: Record<string, unknown>) => ({ range: (s.range as DashRange | undefined) ?? "today" }),
});

type QrRow = { paymentId: string; billId: string; amount: number; tipAmount: number; tableCode: string; paidAt: string };

function QrSalesDetail() {
  const { range: initialRange } = Route.useSearch();
  const [range, setRange] = useState<DashRange>(initialRange);
  const [custom, setCustom] = useState<DateRange | undefined>();
  const [rows, setRows] = useState<QrRow[]>([]);
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
        if (!shiftIds.length) { setRows([]); return; }

        const { data: bills } = await supabase.from("bills")
          .select("id,order_id,paid_at").eq("status","paid").in("shift_id", shiftIds);
        if (!bills?.length) { setRows([]); return; }

        const billIds  = bills.map(b => b.id);
        const orderIds = [...new Set(bills.map(b => b.order_id).filter(Boolean))] as string[];

        const [{ data: pays }, { data: orders }] = await Promise.all([
          supabase.from("payments").select("id,bill_id,amount,tip_amount,created_at")
            .eq("method","qr").in("bill_id", billIds).order("created_at",{ascending:false}),
          supabase.from("orders").select("id,table_id,source,order_number").in("id", orderIds),
        ]);

        const tableIds = [...new Set((orders ?? []).map((o: any) => o.table_id).filter(Boolean))] as string[];
        const { data: tables } = tableIds.length
          ? await supabase.from("restaurant_tables").select("id,code").in("id", tableIds)
          : { data: [] as { id: string; code: string }[] };

        const tblMap  = new Map((tables  ?? []).map((t: any) => [t.id, t.code]));
        const ordMap  = new Map((orders  ?? []).map((o: any) => [o.id, o]));
        const billMap = new Map(bills.map(b => [b.id, b]));

        const getTableCode = (billId: string) => {
          const bill = billMap.get(billId);
          const ord  = bill ? ordMap.get(bill.order_id) : null;
          if (!ord) return "—";
          if (ord.source === "takeout")    return ord.order_number ?? "TO";
          if (ord.source === "staff_meal") return ord.order_number ?? "ST";
          return ord.table_id ? (tblMap.get(ord.table_id) ?? "—") : "—";
        };

        setRows((pays ?? []).map((p: any) => ({
          paymentId: p.id, billId: p.bill_id,
          amount: Number(p.amount), tipAmount: Number(p.tip_amount ?? 0),
          tableCode: getTableCode(p.bill_id),
          paidAt: p.created_at ?? "",
        })));
      } finally { setLoading(false); }
    })();
  }, [bounds, range, custom]);

  const totalNet  = rows.reduce((s, r) => s + r.amount, 0);
  const totalTips = rows.reduce((s, r) => s + r.tipAmount, 0);
  const totalGross = totalNet + totalTips;

  return (
    <div className="p-6 space-y-5 max-w-3xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link to="/dashboard"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Dashboard</Button></Link>
          <h1 className="text-xl font-bold flex items-center gap-2"><QrCode className="h-5 w-5" />QR Transactions</h1>
        </div>
        <DashRangeBar range={range} onRange={setRange} custom={custom} onCustom={setCustom} />
      </div>

      {loading ? <p className="text-muted-foreground text-sm text-center py-8">Loading…</p> : (
        <>
          <div className="grid grid-cols-3 gap-4">
            {[["QR received", totalGross], ["Net QR sales", totalNet], ["Tips", totalTips]].map(([l, v]) => (
              <Card key={l as string}>
                <CardContent className="pt-5">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{l as string}</p>
                  <p className="text-2xl font-bold mt-1 tabular-nums">{thb(v as number)}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">All QR payments ({rows.length})</CardTitle></CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <p className="text-center text-muted-foreground py-6 text-sm">No QR payments in this period</p>
              ) : (
                <div className="space-y-1 text-sm">
                  <div className="grid grid-cols-[3rem_1fr_5rem_5rem] gap-2 text-xs uppercase tracking-wide text-muted-foreground pb-1 border-b">
                    <span>Table</span><span>Time</span><span className="text-right">Net</span><span className="text-right">+Tip</span>
                  </div>
                  {rows.map(r => (
                    <Link key={r.paymentId} to="/payment/$billId" params={{ billId: r.billId }}>
                      <div className="grid grid-cols-[3rem_1fr_5rem_5rem] gap-2 items-center py-1 hover:bg-muted/40 rounded px-1 transition-colors">
                        <span className="font-bold">{r.tableCode}</span>
                        <span className="text-muted-foreground tabular-nums text-xs">
                          {r.paidAt ? new Date(r.paidAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) : "—"}
                        </span>
                        <span className="text-right font-semibold tabular-nums">{thb(r.amount)}</span>
                        <span className="text-right text-muted-foreground tabular-nums">
                          {r.tipAmount > 0 ? `+${thb(r.tipAmount)}` : "—"}
                        </span>
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
