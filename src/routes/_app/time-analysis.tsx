import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { ArrowLeft, Clock3, ReceiptText, Table2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashRangeBar } from "@/components/DashRangeBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { type DashRange, rangeBounds, shiftIdsFor } from "@/lib/dash-range";
import { thb } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/time-analysis")({ component: TimeAnalysis });

type ShiftRow = { id: string; business_day: string };
type OrderRow = {
  id: string;
  shift_id: string | null;
  table_id: string | null;
  source: string;
  guests: number;
  opened_at: string;
  closed_at: string | null;
};
type BillRow = { id: string; order_id: string; total: number; paid_at: string | null };
type HourStat = { guests: number; tables: number; sales: number; bills: number };
type DayStat = { guests: number; tables: number; sales: number; bills: number; days: Set<string> };

const emptyHour = (): HourStat => ({ guests: 0, tables: 0, sales: 0, bills: 0 });
const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
const timeLabel = (iso: string | null) => iso
  ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  : "—";

function TimeAnalysis() {
  const { lang } = useI18n();
  const th = lang === "th";
  const [range, setRange] = useState<DashRange>("week");
  const [custom, setCustom] = useState<DateRange | undefined>();
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [bills, setBills] = useState<BillRow[]>([]);
  const [loading, setLoading] = useState(false);

  const bounds = useMemo<[Date, Date]>(() => {
    if (range === "custom" && custom?.from) {
      const from = new Date(custom.from); from.setHours(0, 0, 0, 0);
      const to = new Date(custom.to ?? custom.from); to.setHours(23, 59, 59, 999);
      return [from, to];
    }
    return rangeBounds(range === "custom" ? "today" : range);
  }, [range, custom]);

  useEffect(() => {
    if (range === "custom" && !custom?.from) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const shiftIds = await shiftIdsFor(range, bounds);
        if (!shiftIds.length) {
          if (!cancelled) { setShifts([]); setOrders([]); setBills([]); }
          return;
        }
        const [{ data: shiftData }, { data: orderData }, { data: billData }] = await Promise.all([
          supabase.from("shifts").select("id,business_day").in("id", shiftIds),
          supabase.from("orders")
            .select("id,shift_id,table_id,source,guests,opened_at,closed_at")
            .in("shift_id", shiftIds).not("is_test", "is", true),
          supabase.from("bills")
            .select("id,order_id,total,paid_at")
            .eq("status", "paid").in("shift_id", shiftIds).not("is_test", "is", true),
        ]);
        if (!cancelled) {
          setShifts((shiftData ?? []) as ShiftRow[]);
          setOrders((orderData ?? []) as OrderRow[]);
          setBills((billData ?? []) as BillRow[]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bounds, range, custom]);

  const analysis = useMemo(() => {
    const shiftDay = new Map(shifts.map((s) => [s.id, s.business_day]));
    const orderShift = new Map(orders.map((o) => [o.id, o.shift_id]));
    const hourly = Array.from({ length: 24 }, emptyHour);
    const weekdays = Array.from({ length: 7 }, () => ({ guests: 0, tables: 0, sales: 0, bills: 0, days: new Set<string>() } as DayStat));
    const daily = new Map<string, { guests: number; tables: number; sales: number; bills: number; lastOrder: string | null; lastPayment: string | null }>();

    const ensureDay = (day: string) => {
      const current = daily.get(day);
      if (current) return current;
      const next = { guests: 0, tables: 0, sales: 0, bills: 0, lastOrder: null, lastPayment: null };
      daily.set(day, next);
      return next;
    };

    const diningOrders = orders.filter((o) => o.table_id && o.source !== "takeout" && o.source !== "staff_meal");
    for (const order of diningOrders) {
      const at = new Date(order.opened_at);
      const h = at.getHours();
      const guests = Math.max(0, Number(order.guests) || 0);
      hourly[h].guests += guests;
      hourly[h].tables += 1;
      const day = order.shift_id ? shiftDay.get(order.shift_id) : undefined;
      if (!day) continue;
      const weekday = new Date(`${day}T12:00:00`).getDay();
      weekdays[weekday].guests += guests;
      weekdays[weekday].tables += 1;
      weekdays[weekday].days.add(day);
      const d = ensureDay(day);
      d.guests += guests;
      d.tables += 1;
      if (!d.lastOrder || order.opened_at > d.lastOrder) d.lastOrder = order.opened_at;
    }

    for (const bill of bills) {
      if (!bill.paid_at) continue;
      const at = new Date(bill.paid_at);
      const h = at.getHours();
      const total = Number(bill.total) || 0;
      hourly[h].sales += total;
      hourly[h].bills += 1;
      const sid = orderShift.get(bill.order_id);
      const day = sid ? shiftDay.get(sid) : undefined;
      if (!day) continue;
      const weekday = new Date(`${day}T12:00:00`).getDay();
      weekdays[weekday].sales += total;
      weekdays[weekday].bills += 1;
      weekdays[weekday].days.add(day);
      const d = ensureDay(day);
      d.sales += total;
      d.bills += 1;
      if (!d.lastPayment || bill.paid_at > d.lastPayment) d.lastPayment = bill.paid_at;
    }

    const totalGuests = diningOrders.reduce((sum, o) => sum + Math.max(0, Number(o.guests) || 0), 0);
    const totalSales = bills.reduce((sum, b) => sum + Number(b.total || 0), 0);
    return {
      hourly,
      weekdays,
      daily: [...daily.entries()].sort((a, b) => b[0].localeCompare(a[0])),
      totalGuests,
      totalTables: diningOrders.length,
      totalSales,
      billCount: bills.length,
    };
  }, [shifts, orders, bills]);

  const activeHours = analysis.hourly
    .map((v, hour) => ({ hour, ...v }))
    .filter((v) => v.guests || v.sales || v.tables || v.bills);
  const maxGuests = Math.max(1, ...activeHours.map((h) => h.guests));
  const maxSales = Math.max(1, ...activeHours.map((h) => h.sales));
  const weekdayNames = th
    ? ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"]
    : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link to="/dashboard"><Button variant="ghost" size="sm"><ArrowLeft className="mr-1 h-4 w-4" />{th ? "แดชบอร์ด" : "Dashboard"}</Button></Link>
          <div>
            <h1 className="text-xl font-bold sm:text-2xl">{th ? "วิเคราะห์ยอดขายตามเวลา" : "Time analysis"}</h1>
            <p className="text-xs text-muted-foreground">{th ? "จำนวนลูกค้านับจากจำนวนที่กรอกตอนเปิดโต๊ะ" : "Guest count uses the number entered when each table is opened."}</p>
          </div>
        </div>
        <DashRangeBar range={range} onRange={setRange} custom={custom} onCustom={setCustom} />
      </div>

      {loading ? <div className="py-16 text-center text-muted-foreground">{th ? "กำลังโหลด…" : "Loading…"}</div> : <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Summary icon={<Users />} label={th ? "ลูกค้า" : "Guests"} value={analysis.totalGuests.toLocaleString()} />
          <Summary icon={<Table2 />} label={th ? "โต๊ะที่เปิด" : "Table sessions"} value={analysis.totalTables.toLocaleString()} />
          <Summary icon={<ReceiptText />} label={th ? "ยอดขาย" : "Sales"} value={thb(analysis.totalSales)} />
          <Summary icon={<Clock3 />} label={th ? "ยอดเฉลี่ยต่อลูกค้า" : "Sales per guest"} value={thb(analysis.totalGuests ? analysis.totalSales / analysis.totalGuests : 0)} />
        </div>

        <Card>
          <CardHeader><CardTitle>{th ? "รายชั่วโมง" : "By hour"}</CardTitle></CardHeader>
          <CardContent>
            {activeHours.length === 0 ? <Empty th={th} /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2">{th ? "เวลา" : "Hour"}</th><th>{th ? "ลูกค้า" : "Guests"}</th><th>{th ? "โต๊ะ" : "Tables"}</th><th>{th ? "บิล" : "Bills"}</th><th>{th ? "ยอดขาย" : "Sales"}</th><th className="w-64">{th ? "ความหนาแน่น" : "Traffic"}</th>
                  </tr></thead>
                  <tbody>{activeHours.map((h) => (
                    <tr key={h.hour} className="border-b last:border-0">
                      <td className="py-3 font-mono font-semibold">{hourLabel(h.hour)}</td>
                      <td className="font-semibold">{h.guests}</td><td>{h.tables}</td><td>{h.bills}</td><td className="font-semibold">{thb(h.sales)}</td>
                      <td><div className="space-y-1"><Bar value={h.guests / maxGuests} className="bg-primary" /><Bar value={h.sales / maxSales} className="bg-amber-500" /></div></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <div className="mt-3 flex gap-4 text-xs text-muted-foreground"><span><i className="mr-1 inline-block h-2 w-4 rounded bg-primary" />{th ? "ลูกค้า" : "Guests"}</span><span><i className="mr-1 inline-block h-2 w-4 rounded bg-amber-500" />{th ? "ยอดขาย" : "Sales"}</span></div>
          </CardContent>
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>{th ? "เฉลี่ยตามวันในสัปดาห์" : "Average by weekday"}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {analysis.weekdays.map((d, i) => {
                const days = Math.max(1, d.days.size);
                return <div key={i} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg border p-3 text-sm">
                  <span className="font-medium">{weekdayNames[i]} <small className="text-muted-foreground">({d.days.size})</small></span>
                  <span>{(d.guests / days).toFixed(1)} {th ? "คน/วัน" : "guests/day"}</span>
                  <span className="w-24 text-right font-semibold">{thb(d.sales / days)}</span>
                </div>;
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{th ? "ออเดอร์สุดท้ายและการชำระเงิน" : "Last order and payment"}</CardTitle></CardHeader>
            <CardContent>
              {analysis.daily.length === 0 ? <Empty th={th} /> : <div className="max-h-[430px] overflow-auto">
                <table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2">{th ? "วันทำการ" : "Business day"}</th><th>{th ? "ลูกค้า" : "Guests"}</th><th>{th ? "ออเดอร์สุดท้าย" : "Last order"}</th><th>{th ? "ชำระล่าสุด" : "Last payment"}</th></tr></thead>
                  <tbody>{analysis.daily.map(([day, d]) => <tr key={day} className="border-b last:border-0"><td className="py-3 font-medium">{day}</td><td>{d.guests}</td><td>{timeLabel(d.lastOrder)}</td><td>{timeLabel(d.lastPayment)}</td></tr>)}</tbody>
                </table>
              </div>}
            </CardContent>
          </Card>
        </div>
      </>}
    </div>
  );
}

function Summary({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <Card><CardContent className="flex items-center gap-3 p-4 sm:p-5"><span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div><p className="text-xs uppercase text-muted-foreground">{label}</p><p className="text-xl font-bold sm:text-2xl">{value}</p></div></CardContent></Card>;
}
function Bar({ value, className }: { value: number; className: string }) {
  return <div className="h-2 overflow-hidden rounded bg-muted"><div className={`h-full rounded ${className}`} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} /></div>;
}
function Empty({ th }: { th: boolean }) { return <p className="py-8 text-center text-sm text-muted-foreground">{th ? "ไม่มีข้อมูลในช่วงนี้" : "No data in this range"}</p>; }
