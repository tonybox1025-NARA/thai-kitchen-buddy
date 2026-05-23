import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { thb } from "@/lib/format";
import { ArrowLeft, Tag } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { DashRangeBar } from "@/components/DashRangeBar";
import { type DashRange, rangeBounds, shiftIdsFor } from "@/lib/dash-range";

export const Route = createFileRoute("/_app/detail-discounts")({
  component: DiscountsDetail,
  validateSearch: (s: Record<string, unknown>) => ({ range: (s.range as DashRange | undefined) ?? "today" }),
});

type DiscRow = {
  type: "percent" | "fixed" | "free_item" | "member";
  label: string;        // e.g. "10%" / "฿50" / "Free: Pad Thai" / "Member"
  amount: number;
  staffName: string;
  tableCode: string;
  billId: string;
  appliedAt: string;
};

const TYPE_META: Record<string, { label: string; cls: string }> = {
  percent:   { label: "% Off",       cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  fixed:     { label: "Fixed ฿",     cls: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" },
  free_item: { label: "Free Item",   cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
  member:    { label: "Member",      cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
};

function DiscountsDetail() {
  const { range: initialRange } = Route.useSearch();
  const [range, setRange] = useState<DashRange>(initialRange);
  const [custom, setCustom] = useState<DateRange | undefined>();
  const [rows, setRows] = useState<DiscRow[]>([]);
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

        // Get paid bills for these shifts
        const { data: bills } = await supabase.from("bills")
          .select("id,order_id,member_discount_amount,paid_at")
          .eq("status","paid").in("shift_id", shiftIds);
        if (!bills?.length) { setRows([]); return; }

        const billIds  = bills.map(b => b.id);
        const orderIds = [...new Set(bills.map(b => b.order_id).filter(Boolean))] as string[];

        // Run queries in parallel
        const [{ data: discounts }, { data: orders }, { data: staffRows }] = await Promise.all([
          (supabase as any).from("bill_discounts")
            .select("bill_id,type,percent_value,fixed_value,free_item_name,amount,applied_by,applied_at")
            .in("bill_id", billIds),
          supabase.from("orders").select("id,table_id,source,order_number").in("id", orderIds),
          supabase.from("staff").select("id,name"),
        ]);

        const tableIds = [...new Set((orders ?? []).map((o: any) => o.table_id).filter(Boolean))] as string[];
        const { data: tables } = tableIds.length
          ? await supabase.from("restaurant_tables").select("id,code").in("id", tableIds)
          : { data: [] as { id: string; code: string }[] };

        // Build lookup maps
        const staffMap  = new Map((staffRows ?? []).map((s: any) => [s.id, s.name]));
        const tblMap    = new Map((tables  ?? []).map((t: any) => [t.id, t.code]));
        const orderMap  = new Map((orders  ?? []).map((o: any) => [o.id, o]));
        const billMap   = new Map(bills.map(b => [b.id, b]));

        const getTableCode = (billId: string): string => {
          const bill  = billMap.get(billId);
          const ord   = bill ? orderMap.get(bill.order_id) : null;
          if (!ord) return "—";
          if (ord.source === "takeout")    return ord.order_number ?? "TO";
          if (ord.source === "staff_meal") return ord.order_number ?? "ST";
          return ord.table_id ? (tblMap.get(ord.table_id) ?? "—") : "—";
        };

        const result: DiscRow[] = [];

        // Structured discounts from bill_discounts
        for (const d of (discounts as any[] ?? [])) {
          let label = "";
          if (d.type === "percent")   label = `${d.percent_value}%`;
          else if (d.type === "fixed") label = thb(d.fixed_value ?? 0);
          else label = d.free_item_name ?? "Free item";
          result.push({
            type: d.type, label, amount: Number(d.amount),
            staffName: d.applied_by ? (staffMap.get(d.applied_by) ?? "—") : "—",
            tableCode: getTableCode(d.bill_id),
            billId: d.bill_id,
            appliedAt: d.applied_at ?? "",
          });
        }

        // Member discounts from bills
        for (const b of bills) {
          if (Number(b.member_discount_amount) > 0) {
            result.push({
              type: "member", label: "Member", amount: Number(b.member_discount_amount),
              staffName: "—",
              tableCode: getTableCode(b.id),
              billId: b.id,
              appliedAt: b.paid_at ?? "",
            });
          }
        }

        result.sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime());
        setRows(result);
      } finally { setLoading(false); }
    })();
  }, [bounds, range, custom]);

  const totals = useMemo(() => {
    const t = { percent: 0, fixed: 0, free_item: 0, member: 0, grand: 0 };
    rows.forEach(r => { t[r.type] += r.amount; t.grand += r.amount; });
    return t;
  }, [rows]);

  return (
    <div className="p-6 space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link to="/dashboard"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Dashboard</Button></Link>
          <h1 className="text-xl font-bold">Discounts</h1>
        </div>
        <DashRangeBar range={range} onRange={setRange} custom={custom} onCustom={setCustom} />
      </div>

      {loading ? <p className="text-muted-foreground text-sm text-center py-8">Loading…</p> : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(["percent","fixed","free_item","member"] as const).map(type => (
              totals[type] > 0 && (
                <Card key={type}>
                  <CardContent className="pt-5">
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${TYPE_META[type].cls}`}>{TYPE_META[type].label}</span>
                    <p className="text-xl font-bold mt-2 tabular-nums">- {thb(totals[type])}</p>
                  </CardContent>
                </Card>
              )
            ))}
          </div>
          {totals.grand > 0 && (
            <div className="text-right text-sm text-muted-foreground">
              Grand total: <span className="font-bold text-foreground tabular-nums">- {thb(totals.grand)}</span> across {rows.length} discount{rows.length!==1?"s":""}
            </div>
          )}

          {/* Detail rows */}
          <Card>
            <CardHeader><CardTitle className="text-base">All discounts ({rows.length})</CardTitle></CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <p className="text-center text-muted-foreground py-6 text-sm">No discounts applied in this period</p>
              ) : (
                <div className="space-y-1.5">
                  {rows.map((r, i) => (
                    <Link key={i} to="/payment/$billId" params={{ billId: r.billId }}>
                      <div className="flex items-center gap-3 text-sm hover:bg-muted/40 rounded-lg px-2 py-2 transition-colors">
                        <div className="text-xs text-muted-foreground shrink-0 w-24 tabular-nums">
                          <div>{r.appliedAt ? new Date(r.appliedAt).toLocaleDateString() : ""}</div>
                          <div>{r.appliedAt ? new Date(r.appliedAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) : ""}</div>
                        </div>
                        <span className="w-12 font-bold shrink-0">{r.tableCode}</span>
                        <div className="flex-1 flex items-center gap-2 min-w-0">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-semibold shrink-0 ${TYPE_META[r.type].cls}`}>{TYPE_META[r.type].label}</span>
                          <span className="text-muted-foreground truncate">{r.label}</span>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">{r.staffName}</span>
                        <span className="font-bold tabular-nums text-destructive shrink-0">- {thb(r.amount)}</span>
                        <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
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
