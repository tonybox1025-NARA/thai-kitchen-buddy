import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { thb } from "@/lib/format";
import type { DateRange } from "react-day-picker";
import { DashRangeBar } from "@/components/DashRangeBar";
import { type DashRange, rangeBounds, shiftIdsFor } from "@/lib/dash-range";
import { ArrowRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/dashboard")({ component: Dashboard });

function Dashboard() {
  const { t } = useI18n();
  const [range, setRange] = useState<DashRange>("today");
  const [custom, setCustom] = useState<DateRange | undefined>();
  const [bills, setBills]     = useState<{ id: string; order_id: string | null; total: number; subtotal: number; discount_amount: number; member_discount_amount: number }[]>([]);
  const [payments, setPayments] = useState<{ method: string; amount: number; tip_amount: number; bill_id: string }[]>([]);
  const [voidsTotal, setVoidsTotal]   = useState(0);
  const [cancelledCt, setCancelledCt] = useState(0);
  const [totalCost, setTotalCost] = useState(0);

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
    (async () => {
      const shiftIds = await shiftIdsFor(range, bounds);
      if (!shiftIds.length) {
        setBills([]); setPayments([]); setVoidsTotal(0); setCancelledCt(0); setTotalCost(0);
        return;
      }
      const [{ data: b }, { data: voidRows }, { data: cancelledOrds }] = await Promise.all([
        supabase.from("bills").select("id,order_id,total,subtotal,discount_amount,member_discount_amount")
          .eq("status","paid").in("shift_id", shiftIds),
        supabase.from("voids").select("amount").in("shift_id", shiftIds),
        supabase.from("orders").select("id").in("shift_id", shiftIds).eq("status","cancelled"),
      ]);
      setBills((b ?? []) as typeof bills);
      setVoidsTotal((voidRows ?? []).reduce((s, v) => s + Number(v.amount), 0));
      setCancelledCt((cancelledOrds ?? []).length);
      const ids      = (b ?? []).map(x => x.id);
      const orderIds = (b ?? []).map(x => x.order_id).filter(Boolean) as string[];
      // Fetch payments + cost items in parallel
      const [paymentsRes, costRes] = await Promise.all([
        ids.length
          ? supabase.from("payments").select("method,amount,tip_amount,bill_id").in("bill_id", ids)
          : Promise.resolve({ data: [] }),
        orderIds.length
          ? (supabase as any).from("order_items").select("unit_cost,qty").in("order_id", orderIds).is("voided_at", null)
          : Promise.resolve({ data: [] }),
      ]);
      setPayments((paymentsRes.data ?? []) as typeof payments);
      setTotalCost(
        ((costRes.data ?? []) as { unit_cost: number; qty: number }[])
          .reduce((s, r) => s + Number(r.unit_cost ?? 0) * Number(r.qty), 0)
      );
    })();
  }, [bounds, range, custom]);

  const stats = useMemo(() => {
    const gross     = bills.reduce((s, b) => s + Number(b.subtotal), 0);
    const net       = bills.reduce((s, b) => s + Number(b.total), 0);
    const discounts = bills.reduce((s, b) => s + Number(b.discount_amount) + Number(b.member_discount_amount), 0);
    const byMethod: Record<string,number> = { cash:0, qr:0, gov_qr:0, card:0 };
    payments.forEach(p => { byMethod[p.method] = (byMethod[p.method]??0) + Number(p.amount); });
    const tipTotal = payments.filter(p => p.method==="qr").reduce((s,p) => s+Number(p.tip_amount??0), 0);
    const grossProfit = gross - totalCost;
    const costPct     = gross > 0 ? (totalCost  / gross) * 100 : 0;
    const marginPct   = gross > 0 ? (grossProfit / gross) * 100 : 0;
    return { gross, net, discounts, byMethod, count: bills.length, tipTotal, qrGross: byMethod.qr + byMethod.gov_qr + tipTotal, grossProfit, costPct, marginPct };
  }, [bills, payments, totalCost]);

  // Encode range into query string for detail pages
  const rangeQ = range === "custom" ? "" : `?range=${range}`;

  const cancelledSub = cancelledCt > 0
    ? `${cancelledCt} ${t("cancelled_orders")}`
    : undefined;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">{t("nav_dashboard")}</h1>
        <DashRangeBar range={range} onRange={setRange} custom={custom} onCustom={setCustom} />
      </div>

      {/* Top summary boxes */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatLink title={t("gross_sales")} value={thb(stats.gross)} to={`/detail-gross${rangeQ}`} />
        <StatLink title={t("net_sales")}   value={thb(stats.net)}   />
        <StatLink title={t("discount")}    value={thb(stats.discounts)} to={`/detail-discounts${rangeQ}`} />
        <StatLink title={t("bills")}       value={String(stats.count)} />
      </div>

      {/* Cost & Margin */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard
          title={t("total_cost")}
          value={thb(totalCost)}
          sub={stats.gross > 0 ? `${stats.costPct.toFixed(1)}% of sales` : undefined}
        />
        <StatCard
          title={t("gross_profit")}
          value={thb(stats.grossProfit)}
          sub={stats.gross > 0 ? `${stats.marginPct.toFixed(1)}% margin` : undefined}
        />
      </div>

      {/* Voids & Cancellations */}
      {(voidsTotal > 0 || cancelledCt > 0) && (
        <StatLink
          title={t("voids_cancellations")}
          value={thb(voidsTotal)}
          sub={cancelledSub}
          to={`/detail-voids${rangeQ}`}
          className="md:col-span-2"
        />
      )}

      {/* Payment methods */}
      <Card>
        <CardHeader><CardTitle>{t("by_method")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <StatCard title={t("cash")}        value={thb(stats.byMethod.cash)} />
            <StatLink title={t("qr_transfer")} value={thb(stats.qrGross)} to={`/detail-qr${rangeQ}`} />
            <StatCard title={t("card")}        value={thb(stats.byMethod.card)} />
          </div>
          {stats.byMethod.gov_qr > 0 && (
            <div className="grid grid-cols-3 gap-4">
              <StatCard title="Government QR" value={thb(stats.byMethod.gov_qr)} />
            </div>
          )}
          {stats.tipTotal > 0 && (
            <div className="border-t pt-4 grid grid-cols-3 gap-4">
              <StatLink title={t("tips_collected")} value={thb(stats.tipTotal)} to={`/detail-tips${rangeQ}`} />
              <StatLink title={t("net_qr_sales")}   value={thb(stats.byMethod.qr)} to={`/detail-qr${rangeQ}`} />
              <div className="rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-4">
                <p className="text-xs uppercase tracking-wide text-amber-700 dark:text-amber-400 font-semibold">{t("tips_cash_payout")}</p>
                <p className="text-2xl font-bold mt-1 text-amber-700 dark:text-amber-300">{thb(stats.tipTotal)}</p>
                <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">{t("tips_payout_hint")}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Clickable stat box
function StatLink({ title, value, sub, to, className }: { title: string; value: string; sub?: string; to?: string; className?: string }) {
  const inner = (
    <Card className={`${to ? "hover:border-primary hover:shadow-md transition-all cursor-pointer group" : ""} ${className ?? ""}`}>
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
        <div className="flex items-end justify-between gap-2 mt-1">
          <p className="text-2xl font-bold">{value}</p>
          {to && <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0 mb-1" />}
        </div>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
  if (!to) return inner;
  return <Link to={to}>{inner}</Link>;
}

// Non-clickable stat box (same visual without hover)
function StatCard({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}
