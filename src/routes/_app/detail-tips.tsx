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
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/detail-tips")({
  component: TipsDetail,
  validateSearch: (s: Record<string, unknown>) => ({ range: (s.range as DashRange | undefined) ?? "today" }),
});

type TipRow = { paymentId: string; billId: string; tipAmount: number; qrAmount: number; tableCode: string; paidAt: string };

function TipsDetail() {
  const { t } = useI18n();
  const { range: initialRange } = Route.useSearch();
  const [range, setRange] = useState<DashRange>(initialRange);
  const [custom, setCustom] = useState<DateRange | undefined>();
  const [rows, setRows] = useState<TipRow[]>([]);
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
            .eq("method","qr").gt("tip_amount",0).in("bill_id", billIds)
            .order("created_at",{ascending:false}),
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
          tipAmount: Number(p.tip_amount ?? 0),
          qrAmount:  Number(p.amount),
          tableCode: getTableCode(p.bill_id),
          paidAt: p.created_at ?? "",
        })));
      } finally { setLoading(false); }
    })();
  }, [bounds, range, custom]);

  const totalTips = rows.reduce((s, r) => s + r.tipAmount, 0);

  return (
    <div className="p-6 space-y-5 max-w-3xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link to="/dashboard"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />{t("nav_dashboard")}</Button></Link>
          <h1 className="text-xl font-bold">{t("tips_collected")}</h1>
        </div>
        <DashRangeBar range={range} onRange={setRange} custom={custom} onCustom={setCustom} />
      </div>

      {loading ? <p className="text-muted-foreground text-sm text-center py-8">{t("loading")}</p> : (
        <>
          <Card>
            <CardContent className="pt-5 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("total_tips_payout")}</p>
                <p className="text-3xl font-black mt-1 text-amber-600 dark:text-amber-400 tabular-nums">{thb(totalTips)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {rows.length} {t("tipped_order_word")}{rows.length !== 1 ? "s" : ""} — {t("pay_cash_staff")}
                </p>
              </div>
              <div className="text-5xl">💰</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">{t("tip_breakdown")}</CardTitle></CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <p className="text-center text-muted-foreground py-6 text-sm">{t("no_tips_period")}</p>
              ) : (
                <div className="space-y-1 text-sm">
                  <div className="grid grid-cols-[3rem_1fr_5rem_5rem] gap-2 text-xs uppercase tracking-wide text-muted-foreground pb-1 border-b">
                    <span>{t("table")}</span><span>{t("time")}</span><span className="text-right">{t("qr_net")}</span><span className="text-right">{t("tips")}</span>
                  </div>
                  {rows.map(r => (
                    <Link key={r.paymentId} to="/payment/$billId" params={{ billId: r.billId }}>
                      <div className="grid grid-cols-[3rem_1fr_5rem_5rem] gap-2 items-center py-1 hover:bg-muted/40 rounded px-1 transition-colors">
                        <span className="font-bold">{r.tableCode}</span>
                        <span className="text-muted-foreground tabular-nums text-xs">
                          {r.paidAt ? new Date(r.paidAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) : "—"}
                        </span>
                        <span className="text-right tabular-nums text-muted-foreground">{thb(r.qrAmount)}</span>
                        <span className="text-right font-bold tabular-nums text-amber-600 dark:text-amber-400">{thb(r.tipAmount)}</span>
                      </div>
                    </Link>
                  ))}
                  <div className="border-t pt-2 flex justify-between font-bold text-sm mt-1">
                    <span>{t("total_tips")}</span>
                    <span className="tabular-nums text-amber-600 dark:text-amber-400">{thb(totalTips)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
