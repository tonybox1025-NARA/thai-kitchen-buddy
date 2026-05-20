import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { thb } from "@/lib/format";
import type { DateRange } from "react-day-picker";

export const Route = createFileRoute("/_app/dashboard")({ component: Dashboard, ssr: false });

type Range = "today" | "yesterday" | "week" | "month" | "custom";

function presetBounds(r: Exclude<Range, "custom">): [Date, Date] {
  const now = new Date();
  const start = new Date(now); const end = new Date(now);
  if (r === "today") { start.setHours(0,0,0,0); end.setHours(23,59,59,999); }
  else if (r === "yesterday") { start.setDate(start.getDate()-1); start.setHours(0,0,0,0); end.setDate(end.getDate()-1); end.setHours(23,59,59,999); }
  else if (r === "week") { const d = start.getDay() || 7; start.setDate(start.getDate()-(d-1)); start.setHours(0,0,0,0); end.setHours(23,59,59,999); }
  else { start.setDate(1); start.setHours(0,0,0,0); end.setHours(23,59,59,999); }
  return [start, end];
}

function Dashboard() {
  const [range, setRange] = useState<Range>("today");
  const [custom, setCustom] = useState<DateRange | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bills, setBills] = useState<{ id: string; total: number; subtotal: number; discount_amount: number; member_discount_amount: number }[]>([]);
  const [payments, setPayments] = useState<{ method: string; amount: number; tip_amount: number; bill_id: string }[]>([]);

  const bounds = useMemo<[Date, Date] | null>(() => {
    if (range === "custom") {
      if (!custom?.from) return null;
      const from = new Date(custom.from); from.setHours(0,0,0,0);
      const to = new Date(custom.to ?? custom.from); to.setHours(23,59,59,999);
      return [from, to];
    }
    return presetBounds(range);
  }, [range, custom]);

  useEffect(() => {
    if (!bounds) return;
    (async () => {
      const [from, to] = bounds;
      let shiftIds: string[] = [];
      if (range === "today") {
        // "Today" = current active (open) shift only. After Z Report, resets to 0.
        const { data: openShifts } = await supabase
          .from("shifts").select("id").eq("status", "open").order("opened_at", { ascending: false }).limit(1);
        shiftIds = (openShifts ?? []).map((s) => s.id);
      } else {
        // Historical ranges: aggregate by closed-shift business_day.
        const fromDay = from.toISOString().slice(0, 10);
        const toDay = to.toISOString().slice(0, 10);
        const { data: shifts } = await supabase
          .from("shifts").select("id")
          .gte("business_day", fromDay).lte("business_day", toDay);
        shiftIds = (shifts ?? []).map((s) => s.id);
      }
      if (!shiftIds.length) { setBills([]); setPayments([]); return; }
      const { data: b } = await supabase
        .from("bills")
        .select("id,total,subtotal,discount_amount,member_discount_amount")
        .eq("status", "paid")
        .in("shift_id", shiftIds);
      setBills((b ?? []) as typeof bills);
      const ids = (b ?? []).map((x) => x.id);
      if (ids.length) {
        const { data: p } = await supabase.from("payments").select("method,amount,tip_amount,bill_id").in("bill_id", ids);
        setPayments((p ?? []) as typeof payments);
      } else setPayments([]);
    })();
  }, [bounds, range]);

  const stats = useMemo(() => {
    const gross = bills.reduce((s, b) => s + Number(b.subtotal), 0);
    const net = bills.reduce((s, b) => s + Number(b.total), 0);
    const discounts = bills.reduce((s, b) => s + Number(b.discount_amount) + Number(b.member_discount_amount), 0);
    const byMethod: Record<string, number> = { cash: 0, qr: 0, card: 0 };
    payments.forEach((p) => { byMethod[p.method] = (byMethod[p.method] ?? 0) + Number(p.amount); });
    const tipTotal = payments.filter((p) => p.method === "qr").reduce((s, p) => s + Number(p.tip_amount ?? 0), 0);
    // qrGross = actual QR received (bill amount + tips); byMethod.qr = net QR (bill amount only)
    const qrGross = byMethod.qr + tipTotal;
    return { gross, net, discounts, byMethod, count: bills.length, tipTotal, qrGross };
  }, [bills, payments]);

  const customLabel = custom?.from
    ? custom.to && custom.to.getTime() !== custom.from.getTime()
      ? `${format(custom.from, "dd MMM")} – ${format(custom.to, "dd MMM yyyy")}`
      : format(custom.from, "dd MMM yyyy")
    : "Custom range";

  return (
    <div className="p-6 space-y-6" lang="en">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex gap-2 flex-wrap">
          {(["today","yesterday","week","month"] as const).map((r) => (
            <Button key={r} variant={range === r ? "default" : "outline"} size="sm" onClick={() => setRange(r)}>
              {r === "today" ? "Today" : r === "yesterday" ? "Yesterday" : r === "week" ? "This week" : "This month"}
            </Button>
          ))}
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant={range === "custom" ? "default" : "outline"}
                size="sm"
                className={cn(!custom?.from && "text-muted-foreground")}
              >
                <CalendarIcon />
                {range === "custom" ? customLabel : "Custom range"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                selected={custom}
                onSelect={(r) => {
                  setCustom(r);
                  setRange("custom");
                  if (r?.from && r?.to) setPickerOpen(false);
                }}
                numberOfMonths={2}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat title="Gross sales" value={thb(stats.gross)} />
        <Stat title="Net sales" value={thb(stats.net)} />
        <Stat title="Discounts" value={thb(stats.discounts)} />
        <Stat title="Bills" value={String(stats.count)} />
      </div>
      <Card>
        <CardHeader><CardTitle>By payment method</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Stat title="Cash" value={thb(stats.byMethod.cash)} />
            <Stat title="QR Transfer" value={thb(stats.qrGross)} />
            <Stat title="Credit card" value={thb(stats.byMethod.card)} />
          </div>
          {stats.tipTotal > 0 && (
            <div className="border-t pt-4 grid grid-cols-3 gap-4">
              <Stat title="Tips collected (QR)" value={thb(stats.tipTotal)} />
              <Stat title="Net QR sales" value={thb(stats.byMethod.qr)} />
              <div className="rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-4">
                <p className="text-xs uppercase tracking-wide text-amber-700 dark:text-amber-400 font-semibold">Tips — cash payout</p>
                <p className="text-2xl font-bold mt-1 text-amber-700 dark:text-amber-300">{thb(stats.tipTotal)}</p>
                <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">Pay this to staff in cash</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}
