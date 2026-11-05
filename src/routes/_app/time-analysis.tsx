import { createFileRoute, Link } from "@tanstack/react-router";
import {
  addDaysKey,
  bkkHour,
  bkkRangeBounds,
  bkkToday,
  pickerBounds,
  weekdayOfKey,
} from "@/lib/bkk-time";
import { useEffect, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ReceiptText,
  Table2,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashRangeBar } from "@/components/DashRangeBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type DashRange, rangeBounds, shiftIdsFor } from "@/lib/dash-range";
import { thb } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { tableLabel } from "@/lib/table";
import { orderBusinessHours } from "@/lib/business-hour-order";

export const Route = createFileRoute("/_app/time-analysis")({ component: TimeAnalysis });

type ShiftRow = { id: string; business_day: string };
type OrderRow = {
  id: string;
  shift_id: string | null;
  table_id: string | null;
  source: string;
  status: string | null;
  guests: number;
  opened_at: string;
  closed_at: string | null;
};

/** Dining sessions only: table orders that were not cancelled (cleanup artifacts excluded). */
function isDiningOrder(o: OrderRow): boolean {
  return (
    !!o.table_id && o.source !== "takeout" && o.source !== "staff_meal" && o.status !== "cancelled"
  );
}

type BillRow = {
  id: string;
  order_id: string;
  subtotal: number;
  total: number;
  paid_at: string | null;
};
type TableRow = { id: string; code: string; capacity: number };
type TableMergeRow = {
  target_order_id: string;
  source_order_id: string;
  target_table_id: string;
  source_table_id: string;
  source_guests: number;
  source_subtotal: number;
};
type HourStat = { guests: number; tables: number; sales: number; bills: number };
type DayStat = { guests: number; tables: number; sales: number; bills: number; days: Set<string> };
type TableStat = {
  id: string;
  code: string;
  capacity: number;
  guests: number;
  sessions: number;
  bills: number;
  sales: number;
  stayMinutes: number;
  completedStays: number;
};

const emptyHour = (): HourStat => ({ guests: 0, tables: 0, sales: 0, bills: 0 });
const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
const currentMonthKey = () => bkkToday().slice(0, 7);
const moveMonthKey = (key: string, offset: number) => {
  const [year, month] = key.split("-").map(Number);
  const moved = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}`;
};
const monthBounds = (key: string): [Date, Date] => {
  const nextMonth = moveMonthKey(key, 1);
  return bkkRangeBounds(`${key}-01`, addDaysKey(`${nextMonth}-01`, -1));
};
const timeLabel = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString([], {
        timeZone: "Asia/Bangkok",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

function TimeAnalysis() {
  const { lang } = useI18n();
  const th = lang === "th";
  const [range, setRange] = useState<DashRange>("week");
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [summaryStartHour, setSummaryStartHour] = useState(2);
  const [summaryEndHour, setSummaryEndHour] = useState(11);
  const [custom, setCustom] = useState<DateRange | undefined>();
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [bills, setBills] = useState<BillRow[]>([]);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [tableMerges, setTableMerges] = useState<TableMergeRow[]>([]);
  const [tableSort, setTableSort] = useState<"sales" | "guests" | "sessions" | "stay">("sales");
  const [loading, setLoading] = useState(false);

  const bounds = useMemo<[Date, Date]>(() => {
    if (range === "month") return monthBounds(selectedMonth);
    if (range === "custom" && custom?.from) {
      const from = pickerBounds(custom.from, custom.to)[0];
      const to = pickerBounds(custom.from, custom.to)[1];
      return [from, to];
    }
    return rangeBounds(range === "custom" ? "today" : range);
  }, [range, custom, selectedMonth]);

  useEffect(() => {
    if (range === "custom" && !custom?.from) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const shiftIds = await shiftIdsFor(range === "month" ? "custom" : range, bounds);
        if (!shiftIds.length) {
          if (!cancelled) {
            setShifts([]);
            setOrders([]);
            setBills([]);
            setTableMerges([]);
          }
          return;
        }
        const [{ data: shiftData }, { data: orderData }, { data: billData }, { data: tableData }] =
          await Promise.all([
            supabase.from("shifts").select("id,business_day").in("id", shiftIds),
            supabase
              .from("orders")
              .select("id,shift_id,table_id,source,status,guests,opened_at,closed_at")
              .in("shift_id", shiftIds)
              .not("is_test", "is", true),
            supabase
              .from("bills")
              .select("id,order_id,subtotal,total,paid_at")
              .eq("status", "paid")
              .in("shift_id", shiftIds)
              .not("is_test", "is", true),
            supabase
              .from("restaurant_tables")
              .select("id,code,capacity")
              .not("is_test", "is", true),
          ]);
        const orderIds = (orderData ?? []).map((order) => order.id);
        const mergeChunks = Array.from({ length: Math.ceil(orderIds.length / 80) }, (_, index) =>
          orderIds.slice(index * 80, index * 80 + 80),
        );
        const mergeResponses = await Promise.all(
          mergeChunks.map((ids) =>
            supabase
              .from("order_table_merges")
              .select(
                "target_order_id,source_order_id,target_table_id,source_table_id,source_guests,source_subtotal",
              )
              .or(`target_order_id.in.(${ids.join(",")}),source_order_id.in.(${ids.join(",")})`),
          ),
        );
        const mergeData = [
          ...new Map(
            mergeResponses
              .flatMap((response) => response.data ?? [])
              .map((merge) => [merge.source_order_id, merge]),
          ).values(),
        ];
        if (!cancelled) {
          setShifts((shiftData ?? []) as ShiftRow[]);
          setOrders((orderData ?? []) as OrderRow[]);
          setBills((billData ?? []) as BillRow[]);
          setTables((tableData ?? []) as TableRow[]);
          setTableMerges(mergeData as TableMergeRow[]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bounds, range, custom]);

  const analysis = useMemo(() => {
    const shiftDay = new Map(shifts.map((s) => [s.id, s.business_day]));
    const orderShift = new Map(orders.map((o) => [o.id, o.shift_id]));
    const hourly = Array.from({ length: 24 }, emptyHour);
    const weekdayHours = Array.from({ length: 7 }, () => Array.from({ length: 24 }, emptyHour));
    const weekdays = Array.from(
      { length: 7 },
      () => ({ guests: 0, tables: 0, sales: 0, bills: 0, days: new Set<string>() }) as DayStat,
    );
    const daily = new Map<
      string,
      {
        guests: number;
        tables: number;
        sales: number;
        bills: number;
        lastOrder: string | null;
        lastPayment: string | null;
      }
    >();

    const ensureDay = (day: string) => {
      const current = daily.get(day);
      if (current) return current;
      const next = { guests: 0, tables: 0, sales: 0, bills: 0, lastOrder: null, lastPayment: null };
      daily.set(day, next);
      return next;
    };

    const mergedGuestsByTarget = new Map<string, number>();
    for (const merge of tableMerges) {
      mergedGuestsByTarget.set(
        merge.target_order_id,
        (mergedGuestsByTarget.get(merge.target_order_id) ?? 0) +
          Math.max(0, Number(merge.source_guests) || 0),
      );
    }
    const diningOrders = orders.filter(isDiningOrder);
    for (const shift of shifts) {
      weekdays[weekdayOfKey(shift.business_day)].days.add(shift.business_day);
    }
    for (const order of diningOrders) {
      const at = new Date(order.opened_at);
      const h = bkkHour(at);
      const guests = Math.max(
        0,
        (Number(order.guests) || 0) - (mergedGuestsByTarget.get(order.id) ?? 0),
      );
      hourly[h].guests += guests;
      hourly[h].tables += 1;
      const day = order.shift_id ? shiftDay.get(order.shift_id) : undefined;
      if (!day) continue;
      const weekday = weekdayOfKey(day);
      weekdays[weekday].guests += guests;
      weekdays[weekday].tables += 1;
      weekdays[weekday].days.add(day);
      weekdayHours[weekday][h].guests += guests;
      weekdayHours[weekday][h].tables += 1;
      const d = ensureDay(day);
      d.guests += guests;
      d.tables += 1;
      if (!d.lastOrder || order.opened_at > d.lastOrder) d.lastOrder = order.opened_at;
    }

    for (const bill of bills) {
      if (!bill.paid_at) continue;
      const at = new Date(bill.paid_at);
      const h = bkkHour(at);
      const total = Number(bill.total) || 0;
      hourly[h].sales += total;
      hourly[h].bills += 1;
      const sid = orderShift.get(bill.order_id);
      const day = sid ? shiftDay.get(sid) : undefined;
      if (!day) continue;
      const weekday = weekdayOfKey(day);
      weekdays[weekday].sales += total;
      weekdays[weekday].bills += 1;
      weekdays[weekday].days.add(day);
      weekdayHours[weekday][h].sales += total;
      weekdayHours[weekday][h].bills += 1;
      const d = ensureDay(day);
      d.sales += total;
      d.bills += 1;
      if (!d.lastPayment || bill.paid_at > d.lastPayment) d.lastPayment = bill.paid_at;
    }

    const totalGuests = diningOrders.reduce(
      (sum, o) =>
        sum + Math.max(0, (Number(o.guests) || 0) - (mergedGuestsByTarget.get(o.id) ?? 0)),
      0,
    );
    const totalSales = bills.reduce((sum, b) => sum + Number(b.total || 0), 0);
    return {
      hourly,
      weekdays,
      weekdayHours,
      daily: [...daily.entries()].sort((a, b) => b[0].localeCompare(a[0])),
      totalGuests,
      totalTables: diningOrders.length,
      totalSales,
      billCount: bills.length,
    };
  }, [shifts, orders, bills, tableMerges]);

  const tableAnalysis = useMemo(() => {
    const stats = new Map<string, TableStat>();
    for (const table of tables) {
      stats.set(table.id, {
        id: table.id,
        code: table.code,
        capacity: Number(table.capacity) || 0,
        guests: 0,
        sessions: 0,
        bills: 0,
        sales: 0,
        stayMinutes: 0,
        completedStays: 0,
      });
    }

    const ensureTable = (tableId: string) => {
      const current = stats.get(tableId);
      if (current) return current;
      const fallback: TableStat = {
        id: tableId,
        code: tableId,
        capacity: 0,
        guests: 0,
        sessions: 0,
        bills: 0,
        sales: 0,
        stayMinutes: 0,
        completedStays: 0,
      };
      stats.set(tableId, fallback);
      return fallback;
    };

    const diningOrders = orders.filter(isDiningOrder);
    const orderById = new Map(diningOrders.map((order) => [order.id, order]));
    const mergesByTarget = new Map<string, TableMergeRow[]>();
    for (const merge of tableMerges) {
      const current = mergesByTarget.get(merge.target_order_id) ?? [];
      current.push(merge);
      mergesByTarget.set(merge.target_order_id, current);
    }

    for (const order of diningOrders) {
      const stat = ensureTable(order.table_id!);
      const mergedGuests = (mergesByTarget.get(order.id) ?? []).reduce(
        (sum, merge) => sum + Math.max(0, Number(merge.source_guests) || 0),
        0,
      );
      stat.guests += Math.max(0, (Number(order.guests) || 0) - mergedGuests);
      stat.sessions += 1;
      if (order.closed_at) {
        const minutes =
          (new Date(order.closed_at).getTime() - new Date(order.opened_at).getTime()) / 60_000;
        if (Number.isFinite(minutes) && minutes >= 0) {
          stat.stayMinutes += minutes;
          stat.completedStays += 1;
        }
      }
    }

    for (const bill of bills) {
      const order = orderById.get(bill.order_id);
      if (!order?.table_id) continue;
      const total = Math.max(0, Number(bill.total) || 0);
      const merges = mergesByTarget.get(order.id) ?? [];
      if (!merges.length) {
        const stat = ensureTable(order.table_id);
        stat.sales += total;
        stat.bills += 1;
        continue;
      }

      const mergedSubtotal = merges.reduce(
        (sum, merge) => sum + Math.max(0, Number(merge.source_subtotal) || 0),
        0,
      );
      const targetSubtotal = Math.max(0, (Number(bill.subtotal) || 0) - mergedSubtotal);
      const allocationBase = targetSubtotal + mergedSubtotal;
      let allocated = 0;
      for (const merge of merges) {
        const sourceSubtotal = Math.max(0, Number(merge.source_subtotal) || 0);
        const sourceSales = allocationBase > 0 ? (total * sourceSubtotal) / allocationBase : 0;
        ensureTable(merge.source_table_id).sales += sourceSales;
        allocated += sourceSales;
      }
      const target = ensureTable(order.table_id);
      target.sales += Math.max(0, total - allocated);
      target.bills += 1;
    }

    const rows = [...stats.values()]
      .filter((stat) => stat.sessions > 0 || stat.sales > 0)
      .sort((a, b) => {
        if (tableSort === "guests") return b.guests - a.guests;
        if (tableSort === "sessions") return b.sessions - a.sessions;
        if (tableSort === "stay") {
          const aStay = a.completedStays ? a.stayMinutes / a.completedStays : 0;
          const bStay = b.completedStays ? b.stayMinutes / b.completedStays : 0;
          return bStay - aStay;
        }
        return b.sales - a.sales;
      });
    const guests = rows.reduce((sum, stat) => sum + stat.guests, 0);
    const sessions = rows.reduce((sum, stat) => sum + stat.sessions, 0);
    const sales = rows.reduce((sum, stat) => sum + stat.sales, 0);
    const stayMinutes = rows.reduce((sum, stat) => sum + stat.stayMinutes, 0);
    const completedStays = rows.reduce((sum, stat) => sum + stat.completedStays, 0);
    return {
      rows,
      guests,
      sessions,
      sales,
      averageStay: completedStays ? stayMinutes / completedStays : 0,
    };
  }, [tables, orders, bills, tableMerges, tableSort]);

  const activeHours = orderBusinessHours(
    analysis.hourly
      .map((v, hour) => ({ hour, ...v }))
      .filter((v) => v.guests || v.sales || v.tables || v.bills),
  );
  const maxGuests = Math.max(1, ...activeHours.map((h) => h.guests));
  const maxSales = Math.max(1, ...activeHours.map((h) => h.sales));
  const weekdayActiveHours = orderBusinessHours(
    Array.from({ length: 24 }, (_, hour) => ({
      hour,
      active: analysis.weekdayHours.some((weekday) => {
        const value = weekday[hour];
        return value.guests || value.tables || value.sales || value.bills;
      }),
    })).filter((value) => value.active),
  );
  const summaryHours = weekdayActiveHours.filter(({ hour }) =>
    summaryStartHour <= summaryEndHour
      ? hour >= summaryStartHour && hour <= summaryEndHour
      : hour >= summaryStartHour || hour <= summaryEndHour,
  );
  const weekdayNames = th
    ? ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"]
    : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const weekdayDisplayOrder = [1, 2, 3, 4, 5, 6, 0];
  const hourOptions = orderBusinessHours(Array.from({ length: 24 }, (_, hour) => ({ hour })));
  const summaryRangeLabel = `${hourLabel(summaryStartHour)}–${hourLabel(summaryEndHour + 1 === 24 ? 0 : summaryEndHour + 1)}`;
  const monthLabel = new Intl.DateTimeFormat(th ? "th-TH" : "en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${selectedMonth}-01T00:00:00Z`));
  const currentMonth = currentMonthKey();

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link to="/dashboard">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 h-4 w-4" />
              {th ? "แดชบอร์ด" : "Dashboard"}
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold sm:text-2xl">
              {th ? "วิเคราะห์ยอดขายตามเวลา" : "Time analysis"}
            </h1>
            <p className="text-xs text-muted-foreground">
              {th
                ? "จำนวนลูกค้านับจากจำนวนที่กรอกตอนเปิดโต๊ะ"
                : "Guest count uses the number entered when each table is opened."}
            </p>
          </div>
        </div>
        <DashRangeBar range={range} onRange={setRange} custom={custom} onCustom={setCustom} />
      </div>

      {range === "month" && (
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-lg border bg-card p-2">
          <span className="mr-auto text-sm font-medium text-muted-foreground">
            {th ? "เดือนที่แสดง" : "Month shown"}
          </span>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-9 w-9"
            aria-label={th ? "เดือนก่อนหน้า" : "Previous month"}
            onClick={() => setSelectedMonth((month) => moveMonthKey(month, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <label className="relative">
            <span className="sr-only">{th ? "เลือกเดือน" : "Choose month"}</span>
            <input
              type="month"
              value={selectedMonth}
              max={currentMonth}
              onChange={(event) => {
                if (event.target.value) {
                  setSelectedMonth(
                    event.target.value > currentMonth ? currentMonth : event.target.value,
                  );
                }
              }}
              className="h-9 rounded-md border bg-background px-3 text-sm font-semibold text-foreground"
            />
          </label>
          <span className="min-w-36 text-center text-sm font-semibold">{monthLabel}</span>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-9 w-9"
            aria-label={th ? "เดือนถัดไป" : "Next month"}
            disabled={selectedMonth >= currentMonth}
            onClick={() => setSelectedMonth((month) => moveMonthKey(month, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <Tabs defaultValue="time" className="space-y-5">
        <TabsList className="h-11 w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="time" className="h-9 gap-2 px-4">
            <Clock3 className="h-4 w-4" />
            {th ? "วิเคราะห์ตามเวลา" : "Time analysis"}
          </TabsTrigger>
          <TabsTrigger value="table" className="h-9 gap-2 px-4">
            <Table2 className="h-4 w-4" />
            {th ? "วิเคราะห์ตามโต๊ะ" : "Table analysis"}
          </TabsTrigger>
        </TabsList>

        {loading ? (
          <div className="py-16 text-center text-muted-foreground">
            {th ? "กำลังโหลด…" : "Loading…"}
          </div>
        ) : (
          <>
            <TabsContent value="time" className="space-y-5">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Summary
                  icon={<Users />}
                  label={th ? "ลูกค้า" : "Guests"}
                  value={analysis.totalGuests.toLocaleString()}
                />
                <Summary
                  icon={<Table2 />}
                  label={th ? "โต๊ะที่เปิด" : "Table sessions"}
                  value={analysis.totalTables.toLocaleString()}
                />
                <Summary
                  icon={<ReceiptText />}
                  label={th ? "ยอดขาย" : "Sales"}
                  value={thb(analysis.totalSales)}
                />
                <Summary
                  icon={<Clock3 />}
                  label={th ? "ยอดเฉลี่ยต่อลูกค้า" : "Sales per guest"}
                  value={thb(analysis.totalGuests ? analysis.totalSales / analysis.totalGuests : 0)}
                />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>{th ? "รายชั่วโมง" : "By hour"}</CardTitle>
                </CardHeader>
                <CardContent>
                  {activeHours.length === 0 ? (
                    <Empty th={th} />
                  ) : (
                    <div className="overflow-x-auto">
                      <div
                        className="mb-2 flex justify-end gap-4 text-xs text-muted-foreground"
                        aria-label={th ? "คำอธิบายสี" : "Traffic legend"}
                      >
                        <span>
                          <i className="mr-1 inline-block h-2 w-4 rounded bg-primary" />
                          {th ? "ลูกค้า" : "Guests"}
                        </span>
                        <span>
                          <i className="mr-1 inline-block h-2 w-4 rounded bg-amber-500" />
                          {th ? "ยอดขาย" : "Sales"}
                        </span>
                      </div>
                      <table className="w-full min-w-[720px] text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                            <th className="py-2">{th ? "เวลา" : "Hour"}</th>
                            <th>{th ? "ลูกค้า" : "Guests"}</th>
                            <th>{th ? "โต๊ะ" : "Tables"}</th>
                            <th>{th ? "บิล" : "Bills"}</th>
                            <th>{th ? "ยอดขาย" : "Sales"}</th>
                            <th className="w-64">{th ? "ความหนาแน่น" : "Traffic"}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeHours.map((h) => (
                            <tr key={h.hour} className="border-b last:border-0">
                              <td className="py-3 font-mono font-semibold">{hourLabel(h.hour)}</td>
                              <td className="font-semibold">{h.guests}</td>
                              <td>{h.tables}</td>
                              <td>{h.bills}</td>
                              <td className="font-semibold">{thb(h.sales)}</td>
                              <td>
                                <div className="space-y-1">
                                  <Bar value={h.guests / maxGuests} className="bg-primary" />
                                  <Bar value={h.sales / maxSales} className="bg-amber-500" />
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{th ? "วันในสัปดาห์ × ชั่วโมง" : "Weekday × hour"}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {th
                      ? "ค่าเฉลี่ยต่อวันที่เปิด แยกตามวันทำการของกะ ยอดหลังเที่ยงคืนยังอยู่กับวันทำการเดิม"
                      : "Average per operating day, grouped by shift business day. After-midnight activity stays with the original business day."}
                  </p>
                </CardHeader>
                <CardContent className="space-y-5">
                  {weekdayActiveHours.length === 0 ? (
                    <Empty th={th} />
                  ) : (
                    <>
                      <div>
                        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                          <h3 className="text-sm font-semibold">
                            {th
                              ? `สรุปช่วงเวลา ${summaryRangeLabel}`
                              : `${summaryRangeLabel} summary`}
                          </h3>
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <label className="flex items-center gap-2">
                              <span className="text-muted-foreground">
                                {th ? "ตั้งแต่" : "From"}
                              </span>
                              <select
                                aria-label={th ? "เวลาเริ่มต้น" : "Summary start hour"}
                                value={summaryStartHour}
                                onChange={(event) =>
                                  setSummaryStartHour(Number(event.target.value))
                                }
                                className="h-9 rounded-md border bg-background px-2 font-mono text-sm"
                              >
                                {hourOptions.map(({ hour }) => (
                                  <option key={hour} value={hour}>
                                    {hourLabel(hour)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="flex items-center gap-2">
                              <span className="text-muted-foreground">
                                {th ? "ถึง" : "Through"}
                              </span>
                              <select
                                aria-label={th ? "เวลาสิ้นสุด" : "Summary end hour"}
                                value={summaryEndHour}
                                onChange={(event) => setSummaryEndHour(Number(event.target.value))}
                                className="h-9 rounded-md border bg-background px-2 font-mono text-sm"
                              >
                                {hourOptions.map(({ hour }) => (
                                  <option key={hour} value={hour}>
                                    {hourLabel(hour)}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                          {weekdayDisplayOrder.map((weekdayIndex) => {
                            const weekday = analysis.weekdays[weekdayIndex];
                            const days = weekday.days.size;
                            const selected = summaryHours.reduce(
                              (total, { hour }) => {
                                const value = analysis.weekdayHours[weekdayIndex][hour];
                                total.guests += value.guests;
                                total.sales += value.sales;
                                total.bills += value.bills;
                                return total;
                              },
                              { guests: 0, sales: 0, bills: 0 },
                            );
                            return (
                              <div key={weekdayIndex} className="rounded-lg border p-3 text-sm">
                                <div className="font-semibold">{weekdayNames[weekdayIndex]}</div>
                                <div className="mt-2 text-lg font-bold">
                                  {days ? (selected.guests / days).toFixed(1) : "0.0"}
                                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                                    {th ? "คน/วัน" : "guests/day"}
                                  </span>
                                </div>
                                <div className="font-semibold text-amber-600">
                                  {thb(days ? selected.sales / days : 0)}
                                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                                    {th ? "/วัน" : "/day"}
                                  </span>
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {days ? (selected.bills / days).toFixed(1) : "0.0"}{" "}
                                  {th ? "บิล/วัน" : "bills/day"} · {days} {th ? "วัน" : "days"}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="overflow-x-auto rounded-lg border">
                        <table className="min-w-max text-sm">
                          <thead>
                            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                              <th className="sticky left-0 z-10 min-w-32 bg-muted px-3 py-3">
                                {th ? "วันทำการ" : "Business day"}
                              </th>
                              {weekdayActiveHours.map(({ hour }) => (
                                <th key={hour} className="min-w-28 px-3 py-3 text-center font-mono">
                                  {hourLabel(hour)}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {weekdayDisplayOrder.map((weekdayIndex) => {
                              const weekday = analysis.weekdays[weekdayIndex];
                              const days = weekday.days.size;
                              return (
                                <tr key={weekdayIndex} className="border-b last:border-0">
                                  <th className="sticky left-0 z-10 bg-background px-3 py-3 text-left">
                                    {weekdayNames[weekdayIndex]}
                                    <small className="ml-1 font-normal text-muted-foreground">
                                      ({days})
                                    </small>
                                  </th>
                                  {weekdayActiveHours.map(({ hour }) => {
                                    const value = analysis.weekdayHours[weekdayIndex][hour];
                                    return (
                                      <td key={hour} className="px-3 py-3 text-center">
                                        <div className="font-semibold">
                                          {days ? (value.guests / days).toFixed(1) : "0.0"}
                                          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                                            {th ? "คน" : "guests"}
                                          </span>
                                        </div>
                                        <div className="text-xs font-medium text-amber-600">
                                          {thb(days ? value.sales / days : 0)}
                                        </div>
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 bg-muted/30">
                              <th className="sticky left-0 z-10 bg-muted px-3 py-3 text-left">
                                {th ? "รวมช่วงเวลา" : "Time total"}
                              </th>
                              {weekdayActiveHours.map(({ hour }) => {
                                const total = analysis.weekdayHours.reduce(
                                  (sum, weekday) => {
                                    sum.guests += weekday[hour].guests;
                                    sum.sales += weekday[hour].sales;
                                    sum.bills += weekday[hour].bills;
                                    return sum;
                                  },
                                  { guests: 0, sales: 0, bills: 0 },
                                );
                                return (
                                  <td key={hour} className="px-3 py-3 text-center">
                                    <div className="font-bold">
                                      {total.guests.toLocaleString()}
                                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                                        {th ? "คน" : "guests"}
                                      </span>
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {total.bills.toLocaleString()} {th ? "บิล" : "bills"}
                                    </div>
                                    <div className="text-xs font-semibold text-amber-600">
                                      {thb(total.sales)}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {th
                          ? "ลูกค้าใช้เวลาที่เปิดโต๊ะ ยอดขายใช้เวลาที่ชำระเงิน และทั้งสองรายการยึดวันทำการของกะ"
                          : "Guests use table-open time; sales use payment time. Both are assigned to the shift business day."}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>

              <div className="grid gap-5 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>{th ? "เฉลี่ยตามวันในสัปดาห์" : "Average by weekday"}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {weekdayDisplayOrder.map((i) => {
                      const d = analysis.weekdays[i];
                      const days = Math.max(1, d.days.size);
                      return (
                        <div
                          key={i}
                          className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg border p-3 text-sm"
                        >
                          <span className="font-medium">
                            {weekdayNames[i]}{" "}
                            <small className="text-muted-foreground">({d.days.size})</small>
                          </span>
                          <span>
                            {(d.guests / days).toFixed(1)} {th ? "คน/วัน" : "guests/day"}
                          </span>
                          <span className="w-24 text-right font-semibold">
                            {thb(d.sales / days)}
                          </span>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>
                      {th ? "ออเดอร์สุดท้ายและการชำระเงิน" : "Last order and payment"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {analysis.daily.length === 0 ? (
                      <Empty th={th} />
                    ) : (
                      <div className="max-h-[430px] overflow-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-xs text-muted-foreground">
                              <th className="py-2">{th ? "วันทำการ" : "Business day"}</th>
                              <th>{th ? "ลูกค้า" : "Guests"}</th>
                              <th>{th ? "ออเดอร์สุดท้าย" : "Last order"}</th>
                              <th>{th ? "ชำระล่าสุด" : "Last payment"}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analysis.daily.map(([day, d]) => (
                              <tr key={day} className="border-b last:border-0">
                                <td className="py-3 font-medium">{day}</td>
                                <td>{d.guests}</td>
                                <td>{timeLabel(d.lastOrder)}</td>
                                <td>{timeLabel(d.lastPayment)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="table" className="space-y-5">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Summary
                  icon={<Users />}
                  label={th ? "ลูกค้าทั้งหมด" : "Table guests"}
                  value={tableAnalysis.guests.toLocaleString()}
                />
                <Summary
                  icon={<Table2 />}
                  label={th ? "รอบโต๊ะ" : "Table sessions"}
                  value={tableAnalysis.sessions.toLocaleString()}
                />
                <Summary
                  icon={<ReceiptText />}
                  label={th ? "ยอดขายจากโต๊ะ" : "Table sales"}
                  value={thb(tableAnalysis.sales)}
                />
                <Summary
                  icon={<Clock3 />}
                  label={th ? "เวลานั่งเฉลี่ย" : "Average stay"}
                  value={durationLabel(tableAnalysis.averageStay, th)}
                />
              </div>

              <Card>
                <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle>{th ? "ผลงานแต่ละโต๊ะ" : "Performance by table"}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {th
                        ? "ไม่รวมออเดอร์กลับบ้านและอาหารพนักงาน"
                        : "Takeout and staff-meal orders are excluded."}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>{th ? "เรียงตาม" : "Sort by"}</span>
                    <select
                      value={tableSort}
                      onChange={(event) => setTableSort(event.target.value as typeof tableSort)}
                      className="h-9 rounded-md border bg-background px-3 text-foreground"
                    >
                      <option value="sales">{th ? "ยอดขาย" : "Sales"}</option>
                      <option value="guests">{th ? "ลูกค้า" : "Guests"}</option>
                      <option value="sessions">{th ? "รอบโต๊ะ" : "Sessions"}</option>
                      <option value="stay">{th ? "เวลานั่ง" : "Average stay"}</option>
                    </select>
                  </label>
                </CardHeader>
                <CardContent>
                  {tableAnalysis.rows.length === 0 ? (
                    <Empty th={th} />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[900px] text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                            <th className="py-2">{th ? "โต๊ะ" : "Table"}</th>
                            <th>{th ? "ความจุ" : "Seats"}</th>
                            <th>{th ? "ลูกค้า" : "Guests"}</th>
                            <th>{th ? "รอบโต๊ะ" : "Sessions"}</th>
                            <th>{th ? "บิล" : "Bills"}</th>
                            <th>{th ? "ยอดขาย" : "Sales"}</th>
                            <th>{th ? "เฉลี่ย/ลูกค้า" : "Per guest"}</th>
                            <th>{th ? "เวลานั่งเฉลี่ย" : "Average stay"}</th>
                            <th className="w-44">{th ? "สัดส่วนยอดขาย" : "Sales share"}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tableAnalysis.rows.map((stat) => (
                            <tr key={stat.id} className="border-b last:border-0">
                              <td className="py-3 text-base font-bold">{tableLabel(stat.code)}</td>
                              <td>{stat.capacity || "—"}</td>
                              <td className="font-semibold">{stat.guests.toLocaleString()}</td>
                              <td>{stat.sessions.toLocaleString()}</td>
                              <td>{stat.bills.toLocaleString()}</td>
                              <td className="font-semibold">{thb(stat.sales)}</td>
                              <td>{thb(stat.guests ? stat.sales / stat.guests : 0)}</td>
                              <td>
                                {durationLabel(
                                  stat.completedStays ? stat.stayMinutes / stat.completedStays : 0,
                                  th,
                                )}
                              </td>
                              <td>
                                <Bar
                                  value={tableAnalysis.sales ? stat.sales / tableAnalysis.sales : 0}
                                  className="bg-primary"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                    {th
                      ? "เมื่อรวมโต๊ะ ระบบจะแบ่งยอดขายกลับไปยังโต๊ะเดิมตามสัดส่วนยอดก่อนส่วนลด ส่วนการย้ายโต๊ะจะนับที่โต๊ะปลายทาง"
                      : "Combined-table sales are allocated back to the original tables in proportion to their pre-discount subtotals. Moved orders are counted under the final table."}
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}

function Summary({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4 sm:p-5">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary [&>svg]:h-5 [&>svg]:w-5">
          {icon}
        </span>
        <div>
          <p className="text-xs uppercase text-muted-foreground">{label}</p>
          <p className="text-xl font-bold sm:text-2xl">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
function Bar({ value, className }: { value: number; className: string }) {
  return (
    <div className="h-2 overflow-hidden rounded bg-muted">
      <div
        className={`h-full rounded ${className}`}
        style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
      />
    </div>
  );
}
function durationLabel(minutes: number, th: boolean) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (!hours) return th ? `${mins} นาที` : `${mins}m`;
  return th ? `${hours} ชม. ${mins} นาที` : `${hours}h ${mins}m`;
}
function Empty({ th }: { th: boolean }) {
  return (
    <p className="py-8 text-center text-sm text-muted-foreground">
      {th ? "ไม่มีข้อมูลในช่วงนี้" : "No data in this range"}
    </p>
  );
}
