import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { thb } from "@/lib/format";
import { ArrowLeft, XCircle, ChevronDown, ChevronRight } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { DashRangeBar } from "@/components/DashRangeBar";
import { type DashRange, rangeBounds, shiftIdsFor } from "@/lib/dash-range";

export const Route = createFileRoute("/_app/detail-voids")({
  component: VoidsDetail,
  validateSearch: (s: Record<string, unknown>) => ({ range: (s.range as DashRange | undefined) ?? "today" }),
});

type CancelledOrder = {
  id: string; tableCode: string; cancelReason: string | null;
  closedAt: string | null; closedByName: string; total: number;
  items: { name: string; qty: number; unit_price: number }[];
};

type VoidItem = {
  id: string; tableCode: string; itemName: string; reason: string | null;
  amount: number; voidedAt: string | null; voidedByName: string;
};

function VoidsDetail() {
  const { range: initialRange } = Route.useSearch();
  const [range, setRange] = useState<DashRange>(initialRange);
  const [custom, setCustom] = useState<DateRange | undefined>();
  const [cancelled, setCancelled] = useState<CancelledOrder[]>([]);
  const [voidItems, setVoidItems] = useState<VoidItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

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
        if (!shiftIds.length) { setCancelled([]); setVoidItems([]); return; }

        // ── Cancelled orders ─────────────────────────────────────────────────
        const { data: cancelledOrds } = await supabase.from("orders")
          .select("*").in("shift_id", shiftIds).eq("status","cancelled")
          .order("closed_at",{ascending:false});

        if (cancelledOrds?.length) {
          const tableIds = [...new Set(cancelledOrds.map(o => o.table_id).filter(Boolean))] as string[];
          const staffIds = [...new Set(cancelledOrds.map(o => (o as any).closed_by).filter(Boolean))] as string[];
          const ordIds   = cancelledOrds.map(o => o.id);

          const [{ data: tables }, { data: staffRows }, { data: itemRows }] = await Promise.all([
            tableIds.length ? supabase.from("restaurant_tables").select("id,code").in("id",tableIds) : Promise.resolve({ data: [] as any[] }),
            staffIds.length ? supabase.from("staff").select("id,name").in("id",staffIds) : Promise.resolve({ data: [] as any[] }),
            supabase.from("order_items").select("order_id,name_th,name_en,qty,unit_price").in("order_id",ordIds),
          ]);

          const tblMap   = new Map((tables   ?? []).map((t: any) => [t.id, t.code]));
          const staffMap = new Map((staffRows ?? []).map((s: any) => [s.id, s.name]));
          const totMap   = new Map<string, number>();
          const itemsMap = new Map<string, { name: string; qty: number; unit_price: number }[]>();
          for (const it of itemRows ?? []) {
            totMap.set(it.order_id, (totMap.get(it.order_id)??0) + it.qty * Number(it.unit_price));
            const arr = itemsMap.get(it.order_id) ?? [];
            arr.push({ name: it.name_th || it.name_en, qty: it.qty, unit_price: Number(it.unit_price) });
            itemsMap.set(it.order_id, arr);
          }

          setCancelled(cancelledOrds.map(o => ({
            id: o.id,
            tableCode: o.table_id ? (tblMap.get(o.table_id) ?? "—") : "—",
            cancelReason: (o as any).cancel_reason ?? null,
            closedAt: o.closed_at ?? null,
            closedByName: (o as any).closed_by ? (staffMap.get((o as any).closed_by) ?? "—") : "—",
            total: totMap.get(o.id) ?? 0,
            items: itemsMap.get(o.id) ?? [],
          })));
        } else { setCancelled([]); }

        // ── Individual void items ─────────────────────────────────────────────
        const { data: voids } = await supabase.from("voids")
          .select("id,order_item_id,reason,amount,voided_by,created_at")
          .in("shift_id", shiftIds).order("created_at",{ascending:false});

        if (voids?.length) {
          const itemIds  = voids.map(v => v.order_item_id).filter(Boolean) as string[];
          const staffIds = [...new Set(voids.map(v => v.voided_by).filter(Boolean))] as string[];

          const [{ data: oi }, { data: staffRows }] = await Promise.all([
            itemIds.length
              ? supabase.from("order_items").select("id,name_th,name_en,order_id").in("id",itemIds)
              : Promise.resolve({ data: [] as any[] }),
            staffIds.length
              ? supabase.from("staff").select("id,name").in("id",staffIds)
              : Promise.resolve({ data: [] as any[] }),
          ]);

          const oiMap    = new Map((oi ?? []).map((x: any) => [x.id, x]));
          const staffMap = new Map((staffRows ?? []).map((s: any) => [s.id, s.name]));

          // Get order → table mapping for these items
          const orderIds = [...new Set((oi ?? []).map((x: any) => x.order_id).filter(Boolean))] as string[];
          let tableCodeForOrder = new Map<string, string>();
          if (orderIds.length) {
            const { data: orders } = await supabase.from("orders")
              .select("id,table_id,source,order_number").in("id", orderIds);
            const tableIds = [...new Set((orders ?? []).map((o: any) => o.table_id).filter(Boolean))] as string[];
            const { data: tables } = tableIds.length
              ? await supabase.from("restaurant_tables").select("id,code").in("id",tableIds)
              : { data: [] as any[] };
            const tblMap2 = new Map((tables ?? []).map((t: any) => [t.id, t.code]));
            for (const o of orders ?? []) {
              if (o.source === "takeout")    { tableCodeForOrder.set(o.id, (o as any).order_number ?? "TO"); continue; }
              if (o.source === "staff_meal") { tableCodeForOrder.set(o.id, (o as any).order_number ?? "ST"); continue; }
              tableCodeForOrder.set(o.id, o.table_id ? (tblMap2.get(o.table_id) ?? "—") : "—");
            }
          }

          setVoidItems(voids.map(v => {
            const item = v.order_item_id ? oiMap.get(v.order_item_id) : null;
            const tableCode = item ? (tableCodeForOrder.get(item.order_id) ?? "—") : "—";
            return {
              id: v.id,
              tableCode,
              itemName: item ? (item.name_th || item.name_en) : "—",
              reason: v.reason ?? null,
              amount: Number(v.amount),
              voidedAt: v.created_at ?? null,
              voidedByName: v.voided_by ? (staffMap.get(v.voided_by) ?? "—") : "—",
            };
          }));
        } else { setVoidItems([]); }

      } finally { setLoading(false); }
    })();
  }, [bounds, range, custom]);

  const voidTotal  = voidItems.reduce((s, v) => s + v.amount, 0);
  const cancelTotal = cancelled.reduce((s, o) => s + o.total, 0);

  return (
    <div className="p-6 space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link to="/dashboard"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Dashboard</Button></Link>
          <h1 className="text-xl font-bold flex items-center gap-2"><XCircle className="h-5 w-5 text-destructive" />Voids &amp; Cancellations</h1>
        </div>
        <DashRangeBar range={range} onRange={setRange} custom={custom} onCustom={setCustom} />
      </div>

      {loading ? <p className="text-muted-foreground text-sm text-center py-8">Loading…</p> : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Cancelled orders ({cancelled.length})</p>
                <p className="text-2xl font-bold mt-1 text-destructive tabular-nums">- {thb(cancelTotal)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Voided items ({voidItems.length})</p>
                <p className="text-2xl font-bold mt-1 text-destructive tabular-nums">- {thb(voidTotal)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Cancelled orders */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2 text-destructive">
                <XCircle className="h-4 w-4" />Cancelled Orders ({cancelled.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {cancelled.length === 0 ? (
                <p className="text-center text-muted-foreground py-4 text-sm">No cancelled orders</p>
              ) : (
                <div className="space-y-1.5">
                  {cancelled.map(o => (
                    <div key={o.id} className="rounded-lg border hover:bg-muted/20 transition-colors cursor-pointer"
                      onClick={() => setExpanded(expanded === o.id ? null : o.id)}>
                      <div className="flex items-center gap-3 px-3 py-2.5 text-sm">
                        <div className="text-xs text-muted-foreground shrink-0 w-24 tabular-nums">
                          {o.closedAt ? (
                            <><div>{new Date(o.closedAt).toLocaleDateString()}</div>
                            <div>{new Date(o.closedAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div></>
                          ) : "—"}
                        </div>
                        <span className="font-bold w-10 shrink-0">{o.tableCode}</span>
                        <span className="flex-1 min-w-0 text-xs text-muted-foreground italic truncate">{o.cancelReason || "—"}</span>
                        <span className="text-xs text-muted-foreground hidden sm:block shrink-0">{o.closedByName}</span>
                        <span className="font-bold tabular-nums text-destructive shrink-0">- {thb(o.total)}</span>
                        {expanded === o.id
                          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                      </div>
                      {expanded === o.id && o.items.length > 0 && (
                        <div className="border-t mx-3 mb-2 pt-2 space-y-1 text-xs text-muted-foreground">
                          {o.items.map((it, i) => (
                            <div key={i} className="flex justify-between">
                              <span>{it.name} <span className="opacity-70">×{it.qty}</span></span>
                              <span className="tabular-nums">{thb(it.qty * it.unit_price)}</span>
                            </div>
                          ))}
                          <div className="border-t pt-1 flex justify-between font-semibold text-foreground">
                            <span>Cancelled by: {o.closedByName}</span>
                            <span className="tabular-nums text-destructive">- {thb(o.total)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Individual void items */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Individual Voided Items ({voidItems.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {voidItems.length === 0 ? (
                <p className="text-center text-muted-foreground py-4 text-sm">No voided items</p>
              ) : (
                <div className="space-y-1 text-sm">
                  <div className="grid grid-cols-[3rem_1fr_1fr_5rem] gap-2 text-xs uppercase tracking-wide text-muted-foreground pb-1 border-b">
                    <span>Table</span><span>Item</span><span>Reason / Staff</span><span className="text-right">Amount</span>
                  </div>
                  {voidItems.map(v => (
                    <div key={v.id} className="grid grid-cols-[3rem_1fr_1fr_5rem] gap-2 items-start py-1 border-b last:border-0">
                      <span className="font-bold">{v.tableCode}</span>
                      <div>
                        <div className="font-medium">{v.itemName}</div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {v.voidedAt ? new Date(v.voidedAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) : ""}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground italic">{v.reason || "—"}</div>
                        <div className="text-xs text-muted-foreground">{v.voidedByName}</div>
                      </div>
                      <span className="text-right font-semibold tabular-nums text-destructive">- {thb(v.amount)}</span>
                    </div>
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
