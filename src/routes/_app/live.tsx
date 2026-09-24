import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { thb } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { ChevronDown, Clock3, RefreshCw, Users, Utensils, Receipt } from "lucide-react";

export const Route = createFileRoute("/_app/live")({ component: LivePage });

type RTable = {
  id: string; code: string; capacity: number;
  status: "available" | "occupied" | "bill_requested";
  guests: number;
};
type OpenOrder = { id: string; table_id: string | null; opened_at: string };
type AttendancePerson = { external_code: string; employee_id: string | null; external_name: string };
type AttendanceDay = { external_code: string; employee_id: string | null; clock_in: string | null; clock_out: string | null };
type TableItemLine = { name_th: string; name_en: string; qty: number; amount: number };

function inferredShift(clockIn: string | null): "14:00–01:00" | "17:00–04:00" | null {
  if (!clockIn) return null;
  const [hours, minutes] = clockIn.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes < 15 * 60 + 30 ? "14:00–01:00" : "17:00–04:00";
}

function minutesSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}
function fmtDuration(min: number): string {
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

const TOP_ITEM_EXCLUDED_EN = new Set([
  "water",
  "rice",
  "steamed rice",
  "khao tom",
  "rice soup",
  "rice soup (khao tom)",
  "rice soup refill",
  "ice",
  "ice (cup)",
  "ice (bucket)",
]);

const TOP_ITEM_EXCLUDED_TH = new Set([
  "น้ำเปล่า",
  "ข้าว",
  "ข้าวสวย",
  "ข้าวต้ม",
  "ข้าวต้มรีฟิล",
  "น้ำแข็ง",
  "น้ำแข็งแก้ว",
  "น้ำแข็งถัง",
]);

function excludeFromTopItems(nameTh: string, nameEn: string): boolean {
  const en = nameEn.trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
  const th = nameTh.trim().replace(/\s+/g, " ");
  return TOP_ITEM_EXCLUDED_EN.has(en)
    || TOP_ITEM_EXCLUDED_TH.has(th)
    || th.startsWith("น้ำแข็ง ");
}

function LivePage() {
  const { t, lang } = useI18n();
  const [tables, setTables] = useState<RTable[]>([]);
  const [openedAt, setOpenedAt] = useState<Map<string, string>>(new Map());
  const [tableTotals, setTableTotals] = useState<Map<string, number>>(new Map());
  const [tableItems, setTableItems] = useState<Map<string, TableItemLine[]>>(new Map());
  const [expandedTableId, setExpandedTableId] = useState<string | null>(null);
  const [byMethod, setByMethod] = useState<Record<string, number>>({ cash: 0, qr: 0, gov_qr: 0, card: 0 });
  const [salesNet, setSalesNet] = useState(0);
  const [billCount, setBillCount] = useState(0);
  const [hasShift, setHasShift] = useState(true);
  const [hourly, setHourly] = useState<{ hour: number; count: number; total: number }[]>([]);
  const [topItems, setTopItems] = useState<{ name_th: string; name_en: string; qty: number }[]>([]);
  const [topItemsOpen, setTopItemsOpen] = useState(false);
  const [attendance, setAttendance] = useState<Array<AttendancePerson & AttendanceDay>>([]);
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [attendanceWorkDate, setAttendanceWorkDate] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date>(new Date());
  const [loading, setLoading] = useState(true);

  const load = async () => {
    // Tables + open orders (for how long each table has been seated)
    const [{ data: tbls }, { data: openOrders }, { data: shift }] = await Promise.all([
      supabase.from("restaurant_tables").select("id,code,capacity,status,guests").not("is_test", "is", true).order("code"),
      supabase.from("orders").select("id,table_id,opened_at").eq("status", "open").not("table_id", "is", null).not("is_test", "is", true),
      supabase.from("shifts").select("id").eq("status", "open").order("opened_at", { ascending: false }).limit(1),
    ]);
    setTables((tbls ?? []) as RTable[]);
    const map = new Map<string, string>();
    for (const o of (openOrders ?? []) as OpenOrder[]) {
      if (o.table_id && (!map.has(o.table_id) || o.opened_at < map.get(o.table_id)!)) map.set(o.table_id, o.opened_at);
    }
    setOpenedAt(map);

    // Read-only attendance summary proxied from the separate Manager backend.
    const { data: attendanceSummary } = await supabase.functions.invoke("attendance-live-summary", { body: {} });
    const attendancePeople = attendanceSummary?.people;
    const attendanceDays = attendanceSummary?.days;
    setAttendanceWorkDate(attendanceSummary?.work_date ?? "");
    const dayByEmployee = new Map(
      ((attendanceDays ?? []) as AttendanceDay[]).map((day) => [day.external_code, day]),
    );
    setAttendance(((attendancePeople ?? []) as AttendancePerson[]).map((person) => ({
      ...person,
      ...(dayByEmployee.get(person.external_code) ?? { external_code: person.external_code, employee_id: person.employee_id, clock_in: null, clock_out: null }),
    })).sort((a, b) => Number(!!b.clock_in) - Number(!!a.clock_in) || a.external_name.localeCompare(b.external_name)));

    // Current unpaid value per active table. Use live, non-voided order items so
    // this stays separate from the paid-sales headline above.
    const openOrderRows = (openOrders ?? []) as OpenOrder[];
    const orderToTable = new Map(
      openOrderRows
        .filter((o): o is OpenOrder & { table_id: string } => !!o.table_id)
        .map((o) => [o.id, o.table_id]),
    );
    const totals = new Map<string, number>();
    const itemGroups = new Map<string, Map<string, TableItemLine>>();
    if (orderToTable.size > 0) {
      const { data: openItems } = await (supabase as any)
        .from("order_items")
        .select("order_id,name_th,name_en,qty,unit_price")
        .in("order_id", [...orderToTable.keys()])
        .is("voided_at", null);
      for (const item of (openItems ?? []) as { order_id: string; name_th: string; name_en: string; qty: number; unit_price: number }[]) {
        const tableId = orderToTable.get(item.order_id);
        if (!tableId) continue;
        const qty = Number(item.qty);
        const amount = qty * Number(item.unit_price);
        totals.set(tableId, (totals.get(tableId) ?? 0) + amount);
        const groups = itemGroups.get(tableId) ?? new Map<string, TableItemLine>();
        const key = `${item.name_en}\u0000${item.name_th}\u0000${item.unit_price}`;
        const current = groups.get(key) ?? { name_th: item.name_th, name_en: item.name_en, qty: 0, amount: 0 };
        current.qty += qty;
        current.amount += amount;
        groups.set(key, current);
        itemGroups.set(tableId, groups);
      }
    }
    setTableTotals(totals);
    setTableItems(new Map(
      [...itemGroups.entries()].map(([tableId, groups]) => [
        tableId,
        [...groups.values()].sort((a, b) => b.amount - a.amount || a.name_en.localeCompare(b.name_en)),
      ]),
    ));

    // Today's paid sales for the open shift
    const currentShift = shift?.[0] ?? null;
    setHasShift(!!currentShift);
    if (currentShift?.id) {
      const [{ data: bills }, { data: refunds }, { data: staffCharges }] = await Promise.all([
        supabase.from("bills").select("id,total,paid_at").in("status", ["paid", "partial_refund", "refunded"]).eq("shift_id", currentShift.id).not("is_test", "is", true),
        supabase.from("refunds").select("amount").eq("shift_id", currentShift.id),
        (supabase as any).from("staff_tab_charges").select("amount").eq("shift_id", currentShift.id).neq("status", "voided"),
      ]);
      const ids = (bills ?? []).map((b) => b.id);
      setBillCount((bills ?? []).length);
      const customerSales = (bills ?? []).reduce((s, b) => s + Number(b.total), 0);
      const staffSales = (staffCharges ?? []).reduce((s: number, row: any) => s + Number(row.amount), 0);
      const refunded = (refunds ?? []).reduce((s, row) => s + Number(row.amount), 0);
      setSalesNet(customerSales + staffSales - refunded);

      // Hourly customer flow (by bill paid_at, local hour)
      const hMap = new Map<number, { count: number; total: number }>();
      for (const b of (bills ?? []) as { total: number; paid_at: string | null }[]) {
        if (!b.paid_at) continue;
        const h = new Date(b.paid_at).getHours();
        const cur = hMap.get(h) ?? { count: 0, total: 0 };
        cur.count += 1; cur.total += Number(b.total);
        hMap.set(h, cur);
      }
      setHourly([...hMap.entries()].map(([hour, v]) => ({ hour, ...v })).sort((a, b) => a.hour - b.hour));

      const [{ data: pays }, { data: shiftOrders }] = await Promise.all([
        ids.length
          ? supabase.from("payments").select("method,amount").in("bill_id", ids)
          : Promise.resolve({ data: [] as { method: string; amount: number }[] }),
        supabase.from("orders").select("id").eq("shift_id", currentShift.id).not("is_test", "is", true),
      ]);
      const m: Record<string, number> = { cash: 0, qr: 0, gov_qr: 0, card: 0 };
      for (const p of pays ?? []) m[p.method] = (m[p.method] ?? 0) + Number(p.amount);
      setByMethod(m);

      // Top items today (all non-voided order items in this shift)
      const orderIds = (shiftOrders ?? []).map((o: { id: string }) => o.id);
      const { data: oi } = orderIds.length
        ? await (supabase as any).from("order_items").select("name_th,name_en,qty,voided_at").in("order_id", orderIds).is("voided_at", null)
        : { data: [] as { name_th: string; name_en: string; qty: number }[] };
      const iMap = new Map<string, { name_th: string; name_en: string; qty: number }>();
      for (const it of (oi ?? []) as { name_th: string; name_en: string; qty: number }[]) {
        if (excludeFromTopItems(it.name_th ?? "", it.name_en ?? "")) continue;
        const key = it.name_en || it.name_th || "Item";
        const cur = iMap.get(key) ?? { name_th: it.name_th, name_en: it.name_en, qty: 0 };
        cur.qty += Number(it.qty);
        iMap.set(key, cur);
      }
      setTopItems([...iMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 10));
    } else {
      setBillCount(0); setSalesNet(0); setByMethod({ cash: 0, qr: 0, gov_qr: 0, card: 0 });
      setHourly([]); setTopItems([]);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, () => void load())
      .subscribe();
    const poll = setInterval(() => void load(), 20000); // refresh durations + safety net
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(poll);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const active = useMemo(
    () => tables
      .filter((t) => t.status !== "available")
      .map((t) => ({
        ...t,
        minutes: openedAt.has(t.id) ? minutesSince(openedAt.get(t.id)!) : 0,
        unpaidTotal: tableTotals.get(t.id) ?? 0,
        items: tableItems.get(t.id) ?? [],
      }))
      .sort((a, b) => (b.status === "bill_requested" ? 1 : 0) - (a.status === "bill_requested" ? 1 : 0) || b.minutes - a.minutes),
    [tables, openedAt, tableTotals, tableItems],
  );
  const occupied = active.length;
  const total = tables.length;
  const seatedGuests = active.reduce((s, t) => s + (t.guests || 0), 0);
  const billRequested = active.filter((t) => t.status === "bill_requested").length;
  const activeTotal = active.reduce((sum, table) => sum + table.unpaidTotal, 0);
  const occPct = total > 0 ? Math.round((occupied / total) * 100) : 0;
  const avgBill = billCount > 0 ? salesNet / billCount : 0;

  return (
    <div className="mx-auto max-w-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("live_title")}</h1>
          <p className="text-xs text-muted-foreground">
            {t("live_updated")} {updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </p>
        </div>
        <button onClick={() => void load()} className="rounded-full border p-2 active:scale-95 transition-transform" aria-label={t("live_refresh")}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Occupancy + sales headline */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground"><Utensils className="h-3.5 w-3.5" />{t("live_tables_in_use")}</div>
            <div className="mt-1 text-3xl font-black tabular-nums">{occupied}<span className="text-lg font-semibold text-muted-foreground">/{total}</span></div>
            <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${occPct}%` }} />
            </div>
            <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" />{seatedGuests} {t("live_guests_seated")}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground"><Receipt className="h-3.5 w-3.5" />{t("live_sales_today")}</div>
            <div className="mt-1 text-3xl font-black tabular-nums">{thb(salesNet)}</div>
            <div className="mt-2 text-xs text-muted-foreground tabular-nums">{billCount} {t("live_bills")} · {t("live_avg")} {thb(avgBill)}</div>
            {!hasShift && <div className="mt-1 text-xs text-amber-600">{t("live_no_shift")}</div>}
          </CardContent>
        </Card>
      </div>

      {/* Today's fingerprint attendance — read-only; payroll remains manager-reviewed. */}
      {attendance.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <button
              type="button"
              onClick={() => setAttendanceOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-3 p-4 text-left"
              aria-expanded={attendanceOpen}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Clock3 className="h-4 w-4" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{lang === "th" ? "ลงเวลาวันนี้" : "Attendance today"}</div>
                  {attendanceWorkDate && <div className="text-[11px] text-muted-foreground">{attendanceWorkDate}</div>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">
                  {attendance.filter((row) => row.clock_in).length}/{attendance.length}
                </Badge>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${attendanceOpen ? "rotate-180" : ""}`} />
              </div>
            </button>
            {attendanceOpen && <div className="space-y-2 border-t px-4 pb-4 pt-3">
              {attendance.map((row) => {
                const shift = inferredShift(row.clock_in);
                const working = !!row.clock_in && !row.clock_out;
                return (
                  <div key={row.external_code} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{row.external_name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {shift ? `${shift} · ${lang === "th" ? "อัตโนมัติ" : "Auto"}` : (lang === "th" ? "ยังไม่มีบันทึก" : "No record yet")}
                      </div>
                    </div>
                    <div className="text-right text-xs tabular-nums">
                      <div>{row.clock_in?.slice(0, 5) ?? "—"} → {row.clock_out?.slice(0, 5) ?? "—"}</div>
                      {working && <div className="mt-0.5 font-medium text-emerald-600">{lang === "th" ? "กำลังทำงาน" : "Working"}</div>}
                    </div>
                  </div>
                );
              })}
            </div>}
          </CardContent>
        </Card>
      )}

      {/* Payment split */}
      {salesNet > 0 && (
        <Card>
          <CardContent className="p-3 grid grid-cols-4 gap-2 text-center">
            {[[t("pm_cash"), byMethod.cash], [t("pm_qr"), byMethod.qr], [t("pm_card"), byMethod.card], [t("pm_gov_qr"), byMethod.gov_qr]].map(([label, val]) => (
              <div key={label as string}>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
                <div className="text-sm font-bold tabular-nums">{thb(Number(val))}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Busy hours today */}
      {hourly.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold">{t("live_busy_hours")}</h2>
          <Card>
            <CardContent className="p-3 space-y-1.5">
              {(() => {
                const max = Math.max(...hourly.map((h) => h.count), 1);
                return hourly.map((h) => (
                  <div key={h.hour} className="flex items-center gap-2 text-xs">
                    <span className="w-10 flex-none tabular-nums text-muted-foreground">{String(h.hour).padStart(2, "0")}:00</span>
                    <div className="h-4 flex-1 rounded bg-muted overflow-hidden">
                      <div className="h-full rounded bg-primary/70" style={{ width: `${(h.count / max) * 100}%` }} />
                    </div>
                    <span className="w-24 flex-none text-right tabular-nums">{h.count} {t("live_bills")} · {thb(h.total)}</span>
                  </div>
                ));
              })()}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Top items today */}
      {topItems.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <button
              type="button"
              onClick={() => setTopItemsOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-3 p-4 text-left"
              aria-expanded={topItemsOpen}
            >
              <span className="text-sm font-semibold">{t("live_top_items")}</span>
              <span className="flex items-center gap-2">
                <Badge variant="secondary">{topItems.length}</Badge>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${topItemsOpen ? "rotate-180" : ""}`} />
              </span>
            </button>
            {topItemsOpen && (
              <div className="max-h-72 overflow-y-auto overscroll-contain border-t p-2 pr-1">
                {topItems.map((it, i) => (
                  <div key={it.name_en || it.name_th} className="flex items-center gap-3 px-1 py-1.5">
                    <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{lang === "th" ? (it.name_th || it.name_en) : (it.name_en || it.name_th)}</span>
                    <span className="flex-none text-sm font-bold tabular-nums">×{it.qty}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Active tables */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("live_active_tables")}</h2>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <div className="text-[10px] leading-none text-muted-foreground">{t("live_active_unpaid")}</div>
              <div className="mt-0.5 text-sm font-bold tabular-nums">{thb(activeTotal)}</div>
            </div>
            {billRequested > 0 && <Badge variant="destructive">{billRequested} {t("live_bill_requested")}</Badge>}
          </div>
        </div>
        {active.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">{t("live_all_free")}</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {active.map((tbl) => (
              <Card key={tbl.id} className={tbl.status === "bill_requested" ? "border-destructive/50" : ""}>
                <CardContent className="p-0">
                  <button
                    type="button"
                    onClick={() => setExpandedTableId((id) => id === tbl.id ? null : tbl.id)}
                    className="flex w-full items-center gap-3 p-3 text-left"
                    aria-expanded={expandedTableId === tbl.id}
                  >
                    <div className="grid h-11 w-11 flex-none place-items-center rounded-lg bg-primary/10 text-lg font-bold text-primary">{tbl.code}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{t("table")} {tbl.code}</span>
                        {tbl.status === "bill_requested" && <Badge variant="destructive" className="text-[10px]">{t("bill_requested")}</Badge>}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                        <span className="flex items-center gap-1"><Users className="h-3 w-3" />{tbl.guests || "?"}</span>
                        {tbl.minutes > 0 && <span>· {fmtDuration(tbl.minutes)}</span>}
                      </div>
                    </div>
                    <div className="flex flex-none items-center gap-2 text-right">
                      <div>
                        <div className="text-[10px] text-muted-foreground">{t("live_table_total")}</div>
                        <div className="text-base font-bold tabular-nums">{thb(tbl.unpaidTotal)}</div>
                      </div>
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expandedTableId === tbl.id ? "rotate-180" : ""}`} />
                    </div>
                  </button>
                  {expandedTableId === tbl.id && (
                    <div className="space-y-2 border-t px-3 py-3">
                      {tbl.items.length > 0 ? tbl.items.map((item) => (
                        <div key={`${item.name_en}-${item.name_th}-${item.amount}`} className="flex items-start gap-3 text-sm">
                          <span className="flex-none font-semibold tabular-nums">{item.qty}×</span>
                          <span className="min-w-0 flex-1">{lang === "th" ? (item.name_th || item.name_en) : (item.name_en || item.name_th)}</span>
                          <span className="flex-none font-medium tabular-nums">{thb(item.amount)}</span>
                        </div>
                      )) : (
                        <div className="py-1 text-center text-xs text-muted-foreground">
                          {lang === "th" ? "ยังไม่มีรายการอาหาร" : "No order items yet"}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
