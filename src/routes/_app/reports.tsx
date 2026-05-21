import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { thb } from "@/lib/format";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ManagerPinDialog } from "@/components/ManagerPinDialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { PencilLine, ArrowRight, CalendarIcon, XCircle } from "lucide-react";

export const Route = createFileRoute("/_app/reports")({ component: Reports });

const DENOMS = [1000, 500, 100, 50, 20, 10, 5, 1];

type Shift = { id: string; business_day: string; opened_at: string; closed_at: string | null; opening_float: number; status: "open" | "closed" };
type ReportData = {
  gross: number; net: number; discount: number; member: number;
  voids: number; refunds: number; byMethod: Record<string, number>;
  openingFloat: number; bills: number;
  tipTotal: number; // sum of tip_amount on QR payments; payment.amount excludes tip
  cancelledCount: number; // number of cancelled (table-closed) orders this shift
};

type AdjPay = {
  payment_id: string; bill_id: string; table_code: string;
  amount: number; tip_amount: number;
  method: "cash" | "qr" | "card"; paid_at: string;
};

type BillRow = {
  id: string; paid_at: string; total: number;
  table_code: string;
  payments: { method: string; amount: number }[];
};

function getQrGrossReceived(r: ReportData) {
  return r.byMethod.qr + r.tipTotal;
}

function getNetQrSales(r: ReportData) {
  return r.byMethod.qr;
}

function calcCashSummary(cashCount: Record<number, number>, r: ReportData) {
  const cashTotal = Object.entries(cashCount).reduce((s, [d, c]) => s + Number(d) * (c || 0), 0);
  // Tips are collected via QR and paid out from QR settlement — unrelated to the cash drawer.
  const expected = r.openingFloat + r.byMethod.cash;
  return { cashTotal, expected, overShort: cashTotal - expected };
}

function openPrintWindow(
  kind: "X" | "Z",
  r: ReportData,
  shift: Shift,
  counts: Record<number, number>,
  restaurantName: string,
) {
  const { cashTotal, expected, overShort } = calcCashSummary(counts, r);
  const row = (l: string, v: string, b = false) =>
    `<tr${b ? ' style="font-weight:700"' : ""}><td>${l}</td><td style="text-align:right">${v}</td></tr>`;
  const denomRows = DENOMS.filter((d) => (counts[d] ?? 0) > 0)
    .map((d) => row(`${d}฿ × ${counts[d]}`, thb(d * counts[d])))
    .join("") || `<tr><td colspan="2" style="color:#888">No denominations entered</td></tr>`;
  const now = new Date();
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${kind} Report</title>
<style>body{font-family:ui-sans-serif,system-ui;padding:24px;max-width:480px;margin:auto}h1{font-size:20px;margin:0 0 4px;text-align:center}h2{font-size:14px;margin:16px 0 4px;border-bottom:1px solid #ccc;padding-bottom:2px}table{width:100%;border-collapse:collapse;font-size:13px}td{padding:2px 0}.meta{text-align:center;font-size:12px;color:#555;margin-bottom:8px}</style>
</head><body>
<h1>${restaurantName || "Restaurant"}</h1>
<div class="meta">${kind} Report · Business day ${shift.business_day}<br/>Printed ${now.toLocaleString()}</div>
<h2>Sales</h2><table>
${row("Gross sales", thb(r.gross))}
${row("Discount", `- ${thb(r.discount)}`)}
${row("Member discount", `- ${thb(r.member)}`)}
${row("Net sales", thb(r.net), true)}
</table>
<h2>Payments</h2><table>
${row("Cash", thb(r.byMethod.cash))}
${row("QR revenue", thb(getQrGrossReceived(r)))}
${r.tipTotal > 0 ? row("  Tips collected (QR)", thb(r.tipTotal)) : ""}
${r.tipTotal > 0 ? row("  Tips paid out (cash)", `- ${thb(r.tipTotal)}`) : ""}
${r.tipTotal > 0 ? row("  Net QR sales", thb(getNetQrSales(r)), true) : ""}
${row("Credit card", thb(r.byMethod.card))}
</table>
<h2>Other</h2><table>
${row("Voids &amp; Cancellations", thb(r.voids))}
${row("Refunds total", thb(r.refunds))}
${row("Bills", String(r.bills))}
${r.cancelledCount > 0 ? row("Cancelled orders", String(r.cancelledCount)) : ""}
</table>
<h2>Cash count</h2><table>${denomRows}</table>
<h2>Cash drawer</h2><table>
${row("Opening float", thb(r.openingFloat))}
${row("Counted", thb(cashTotal))}
${row("Expected", thb(expected))}
${row("Over / Short", thb(overShort), true)}
</table>
<script>window.onload=()=>setTimeout(()=>window.print(),100)</script>
</body></html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
}

function Reports() {
  const { staff } = useAuth();
  const { t } = useI18n();
  const [shift, setShift] = useState<Shift | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [xDlg, setXDlg] = useState(false);
  const [zDlg, setZDlg] = useState(false);
  const [xCashCount, setXCashCount] = useState<Record<number, number>>({});
  const [cashCount, setCashCount] = useState<Record<number, number>>({});
  const [restaurantName, setRestaurantName] = useState("");
  const [managerOpen, setManagerOpen] = useState(false);
  const [pendingZ, setPendingZ] = useState(false);
  const [xLoading, setXLoading] = useState(false);

  // Scenario 2: Z-report payment type adjustment
  const [adjDlg, setAdjDlg] = useState(false);
  const [adjPays, setAdjPays] = useState<AdjPay[]>([]);
  const [adjChanges, setAdjChanges] = useState<Record<string, "cash" | "qr" | "card">>({});
  const [adjLoading, setAdjLoading] = useState(false);

  useEffect(() => {
    supabase.from("shifts").select("*").eq("status", "open").maybeSingle().then(({ data }) => {
      setShift((data as Shift) ?? null);
    });
    supabase.from("settings").select("restaurant_name").eq("id", 1).maybeSingle().then(({ data }) => {
      setRestaurantName((data as any)?.restaurant_name ?? "");
    });
  }, []);

  const buildReport = async (s: Shift): Promise<ReportData> => {
    const { data: bills } = await supabase.from("bills").select("id,total,subtotal,discount_amount,member_discount_amount").eq("shift_id", s.id).eq("status", "paid");
    const billIds = (bills ?? []).map((b) => b.id);
    const [{ data: pays }, { data: voids }, { data: refunds }, { data: cancelledOrds }] = await Promise.all([
      billIds.length
        ? supabase.from("payments").select("method,amount,tip_amount").in("bill_id", billIds)
        : Promise.resolve({ data: [] as { method: string; amount: number; tip_amount: number }[], error: null }),
      supabase.from("voids").select("amount").eq("shift_id", s.id),
      supabase.from("refunds").select("amount").eq("shift_id", s.id),
      supabase.from("orders").select("id").eq("shift_id", s.id).eq("status", "cancelled"),
    ]);
    const gross = (bills ?? []).reduce((x, b) => x + Number(b.subtotal), 0);
    const net = (bills ?? []).reduce((x, b) => x + Number(b.total), 0);
    const discount = (bills ?? []).reduce((x, b) => x + Number(b.discount_amount), 0);
    const member = (bills ?? []).reduce((x, b) => x + Number(b.member_discount_amount), 0);
    const byMethod: Record<string, number> = { cash: 0, qr: 0, card: 0 };
    (pays ?? []).forEach((p) => { byMethod[p.method] = (byMethod[p.method] ?? 0) + Number(p.amount); });
    const tipTotal = (pays ?? []).filter((p) => p.method === "qr").reduce((s, p) => s + Number(p.tip_amount ?? 0), 0);
    return {
      gross, net, discount, member,
      voids: (voids ?? []).reduce((x, v) => x + Number(v.amount), 0),
      refunds: (refunds ?? []).reduce((x, v) => x + Number(v.amount), 0),
      byMethod, openingFloat: Number(s.opening_float), bills: (bills ?? []).length,
      tipTotal,
      cancelledCount: (cancelledOrds ?? []).length,
    };
  };

  const runX = async () => {
    if (!shift) return;
    setXLoading(true);
    try {
      const r = await buildReport(shift);
      setReport(r);
      setXCashCount({});
      setXDlg(true);
    } catch {
      toast.error("Failed to load report");
    } finally {
      setXLoading(false);
    }
  };

  const startZ = async () => {
    if (!shift) return;
    const r = await buildReport(shift);
    setReport(r);
    setCashCount({});
    setZDlg(true);
  };

  const submitZ = async () => {
    if (!shift || !report) return;
    if (staff?.role === "staff") { setPendingZ(true); setManagerOpen(true); return; }
    await doZ();
  };

  const doZ = async () => {
    if (!shift || !report) return;
    const cashTotal = Object.entries(cashCount).reduce((s, [d, c]) => s + Number(d) * (c || 0), 0);
    const expected = report.openingFloat + report.byMethod.cash;
    const overShort = cashTotal - expected;
    await supabase.from("shifts").update({
      closed_at: new Date().toISOString(), closed_by: staff?.id, status: "closed",
      cash_count: cashCount, totals: { ...report, cashTotal, expected, overShort },
    }).eq("id", shift.id);
    setZDlg(false); setShift(null); setReport(null);
    toast.success("Z report saved · next sale will start a new shift");
  };

  const openAdj = async () => {
    if (!shift) return;
    setAdjLoading(true);
    try {
      // Fetch paid bills for this shift
      const { data: bills } = await supabase
        .from("bills").select("id,total,paid_at,order_id")
        .eq("shift_id", shift.id).eq("status", "paid").order("paid_at");
      if (!bills?.length) { toast.error("No paid bills this shift"); return; }

      const billIds = bills.map((b) => b.id);
      const orderIds = bills.map((b) => b.order_id).filter(Boolean) as string[];

      // Resolve table codes
      const { data: orders } = await supabase.from("orders").select("id,table_id").in("id", orderIds);
      const tableIds = [...new Set((orders ?? []).map((o) => o.table_id).filter(Boolean))] as string[];
      const { data: tables } = tableIds.length
        ? await supabase.from("restaurant_tables").select("id,code").in("id", tableIds)
        : { data: [] as { id: string; code: string }[] };

      const tableMap = new Map((tables ?? []).map((t) => [t.id, t.code]));
      const orderMap = new Map((orders ?? []).map((o) => [o.id, o.table_id as string]));
      const billOrderMap = new Map(bills.map((b) => [b.id, b.order_id as string]));

      // Fetch payments for those bills
      const { data: pays } = await supabase
        .from("payments").select("id,bill_id,method,amount,tip_amount,created_at")
        .in("bill_id", billIds).order("created_at");

      const list: AdjPay[] = (pays ?? []).map((p) => {
        const bill = bills.find((b) => b.id === p.bill_id);
        const orderId = billOrderMap.get(p.bill_id);
        const tableId = orderId ? orderMap.get(orderId) : undefined;
        const tableCode = tableId ? (tableMap.get(tableId) ?? "—") : "—";
        return {
          payment_id: p.id, bill_id: p.bill_id, table_code: tableCode,
          amount: Number(p.amount), tip_amount: Number(p.tip_amount ?? 0),
          method: p.method as "cash" | "qr" | "card",
          paid_at: bill?.paid_at ?? (p.created_at as string),
        };
      });

      setAdjPays(list);
      setAdjChanges({});
      setAdjDlg(true);
    } catch {
      toast.error("Failed to load payments");
    } finally {
      setAdjLoading(false);
    }
  };

  const applyAdj = async () => {
    if (!staff) return;
    const changed = adjPays.filter((p) => adjChanges[p.payment_id] && adjChanges[p.payment_id] !== p.method);
    if (!changed.length) { setAdjDlg(false); return; }
    for (const p of changed) {
      await supabase.from("payments").update({ method: adjChanges[p.payment_id] }).eq("id", p.payment_id);
      await (supabase as any).from("payment_corrections").insert({
        payment_id: p.payment_id, bill_id: p.bill_id,
        corrected_by: staff.id, old_method: p.method,
        new_method: adjChanges[p.payment_id], reason: "Z Report adjustment",
      });
    }
    toast.success(`${changed.length} payment${changed.length > 1 ? "s" : ""} corrected`);
    setAdjDlg(false);
    // Refresh report data with corrected payment methods
    if (shift) { const updated = await buildReport(shift); setReport(updated); }
  };

  const adjSummary = useMemo(() => {
    if (!adjPays.length) return null;
    const before: Record<string, number> = { cash: 0, qr: 0, card: 0 };
    const after: Record<string, number> = { cash: 0, qr: 0, card: 0 };
    for (const p of adjPays) {
      before[p.method] = (before[p.method] ?? 0) + p.amount;
      const m = adjChanges[p.payment_id] ?? p.method;
      after[m] = (after[m] ?? 0) + p.amount;
    }
    const changeCount = adjPays.filter((p) => adjChanges[p.payment_id] && adjChanges[p.payment_id] !== p.method).length;
    return { before, after, changeCount };
  }, [adjPays, adjChanges]);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">{t("nav_reports")}</h1>

      <Tabs defaultValue="shift">
        <TabsList>
          <TabsTrigger value="shift">Shift Reports</TabsTrigger>
          <TabsTrigger value="history">Bill History</TabsTrigger>
          {(staff?.role === "admin" || staff?.role === "manager") && (
            <TabsTrigger value="cancelled">Cancelled Orders</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="shift" className="space-y-4 mt-4">
          {!shift ? (
            <Card>
              <CardContent className="py-12 text-center space-y-4">
                <p className="text-muted-foreground">{t("no_open_shift")}</p>
                <p className="text-sm text-muted-foreground">A new shift starts automatically with the next sale, using the configured starting cash.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{t("shift")} · {t("business_day")}: {shift.business_day}</CardTitle>
                </CardHeader>
                <CardContent className="flex gap-3">
                  <Button onClick={runX} variant="outline" disabled={xLoading}>
                    {xLoading ? "Loading…" : t("x_report")}
                  </Button>
                  <Button onClick={startZ} variant="destructive">{t("z_report")}</Button>
                </CardContent>
              </Card>
              <CancelledOrdersSection shiftId={shift.id} />
            </>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <BillHistoryTab />
        </TabsContent>

        {(staff?.role === "admin" || staff?.role === "manager") && (
          <TabsContent value="cancelled" className="mt-4">
            <CancelledOrdersTab />
          </TabsContent>
        )}
      </Tabs>

      {/* X Report dialog */}
      <Dialog open={xDlg} onOpenChange={setXDlg}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("x_report")}</DialogTitle>
          </DialogHeader>
          {report && (
            <div className="space-y-4">
              <ReportCard r={report} />
              <div className="space-y-3">
                <p className="text-sm font-semibold">{t("cash_count")}</p>
                <DenomGrid cashCount={xCashCount} onChange={setXCashCount} />
                <CashSummary r={report} cashCount={xCashCount} overShortLabel={t("over_short")} />
              </div>
            </div>
          )}
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setXDlg(false)}>{t("cancel")}</Button>
            <Button onClick={() => { if (report && shift) openPrintWindow("X", report, shift, xCashCount, restaurantName); }}>
              Print X Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Z Report dialog */}
      <Dialog open={zDlg} onOpenChange={setZDlg}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("z_report")}</DialogTitle>
          </DialogHeader>
          {report && (
            <div className="space-y-4">
              <ReportCard r={report} />
              <Button variant="outline" className="w-full border-amber-400 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
                onClick={openAdj} disabled={adjLoading}>
                <PencilLine className="h-4 w-4 mr-2" />
                {adjLoading ? "Loading…" : "Adjust Payment Types"}
              </Button>
              <div className="space-y-3">
                <p className="text-sm font-semibold">{t("cash_count")}</p>
                <DenomGrid cashCount={cashCount} onChange={setCashCount} />
                <CashSummary r={report} cashCount={cashCount} overShortLabel={t("over_short")} />
              </div>
            </div>
          )}
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setZDlg(false)}>{t("cancel")}</Button>
            <Button onClick={() => {
              if (report && shift) openPrintWindow("Z", report, shift, cashCount, restaurantName);
              submitZ();
            }}>
              Print &amp; Close shift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjust Payment Types dialog (Scenario 2) */}
      <Dialog open={adjDlg} onOpenChange={setAdjDlg}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PencilLine className="h-4 w-4" />Adjust Payment Types
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">Admin / Manager only · all changes are logged for audit · totals update after Apply</p>

          {/* Payment rows */}
          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {adjPays.map((p) => {
              const next = adjChanges[p.payment_id] ?? p.method;
              const changed = next !== p.method;
              return (
                <div key={p.payment_id}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${changed ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30" : "bg-card"}`}>
                  <span className="w-10 shrink-0 text-muted-foreground text-xs">
                    {new Date(p.paid_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="w-8 shrink-0 font-medium text-xs text-muted-foreground">{p.table_code}</span>
                  <span className="w-20 shrink-0 font-semibold tabular-nums">{thb(p.amount)}</span>
                  {p.tip_amount > 0 && <span className="text-xs text-muted-foreground shrink-0">+tip {thb(p.tip_amount)}</span>}
                  <Select value={next} onValueChange={(v) => setAdjChanges({ ...adjChanges, [p.payment_id]: v as "cash" | "qr" | "card" })}>
                    <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="qr">QR Transfer</SelectItem>
                      <SelectItem value="card">Credit card</SelectItem>
                    </SelectContent>
                  </Select>
                  {changed && (
                    <span className="text-xs text-amber-600 shrink-0">{p.method} → {next}</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Before / After summary */}
          {adjSummary && (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Before / After</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                {(["cash", "qr", "card"] as const).map((m) => {
                  const bef = adjSummary.before[m] ?? 0;
                  const aft = adjSummary.after[m] ?? 0;
                  const diff = aft - bef;
                  return (
                    <div key={m} className={`rounded p-2 ${diff !== 0 ? "bg-amber-100 dark:bg-amber-900/40" : "bg-background"}`}>
                      <p className="text-xs text-muted-foreground capitalize">{m === "qr" ? "QR Transfer" : m === "card" ? "Credit card" : "Cash"}</p>
                      <p className="font-semibold tabular-nums">{thb(aft)}</p>
                      {diff !== 0 && (
                        <p className={`text-xs tabular-nums font-medium ${diff > 0 ? "text-green-600" : "text-red-500"}`}>
                          {diff > 0 ? "+" : ""}{thb(diff)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjDlg(false)}>{t("cancel")}</Button>
            <Button onClick={applyAdj} disabled={!adjSummary?.changeCount}>
              Apply {adjSummary?.changeCount ? `${adjSummary.changeCount} correction${adjSummary.changeCount > 1 ? "s" : ""}` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ManagerPinDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        onApproved={() => { if (pendingZ) doZ(); setPendingZ(false); }}
      />
    </div>
  );
}

type HistRange = "today" | "yesterday" | "week" | "month" | "custom";

function histBounds(r: Exclude<HistRange, "custom">): [Date, Date] {
  const now = new Date();
  const s = new Date(now); const e = new Date(now);
  if (r === "today") { s.setHours(0,0,0,0); e.setHours(23,59,59,999); }
  else if (r === "yesterday") { s.setDate(s.getDate()-1); s.setHours(0,0,0,0); e.setDate(e.getDate()-1); e.setHours(23,59,59,999); }
  else if (r === "week") { const d = s.getDay()||7; s.setDate(s.getDate()-(d-1)); s.setHours(0,0,0,0); e.setHours(23,59,59,999); }
  else { s.setDate(1); s.setHours(0,0,0,0); e.setHours(23,59,59,999); }
  return [s, e];
}

function BillHistoryTab() {
  const [range, setRange] = useState<HistRange>("today");
  const [custom, setCustom] = useState<DateRange | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bills, setBills] = useState<BillRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const getBounds = (): [Date, Date] | null => {
    if (range === "custom") {
      if (!custom?.from) return null;
      const s = new Date(custom.from); s.setHours(0,0,0,0);
      const e = new Date(custom.to ?? custom.from); e.setHours(23,59,59,999);
      return [s, e];
    }
    return histBounds(range);
  };

  const load = async () => {
    const bounds = getBounds();
    if (!bounds) return;
    setLoading(true);
    try {
      const [fromDt, toDt] = bounds;

      const { data: rawBills } = await supabase
        .from("bills")
        .select("id,total,paid_at,order_id")
        .eq("status", "paid")
        .gte("paid_at", fromDt.toISOString())
        .lte("paid_at", toDt.toISOString())
        .order("paid_at", { ascending: false })
        .limit(500);

      if (!rawBills?.length) { setBills([]); setLoaded(true); return; }

      const billIds = rawBills.map((b) => b.id);
      const orderIds = rawBills.map((b) => b.order_id).filter(Boolean) as string[];

      const [{ data: orders }, { data: pays }] = await Promise.all([
        supabase.from("orders").select("id,table_id").in("id", orderIds),
        supabase.from("payments").select("bill_id,method,amount").in("bill_id", billIds),
      ]);

      const tableIds = [...new Set((orders ?? []).map((o) => o.table_id).filter(Boolean))] as string[];
      const { data: tables } = tableIds.length
        ? await supabase.from("restaurant_tables").select("id,code").in("id", tableIds)
        : { data: [] as { id: string; code: string }[] };

      const tableMap = new Map((tables ?? []).map((t) => [t.id, t.code]));
      const orderMap = new Map((orders ?? []).map((o) => [o.id, o.table_id as string]));

      const result: BillRow[] = rawBills.map((b) => {
        const tableId = orderMap.get(b.order_id ?? "");
        return {
          id: b.id,
          paid_at: b.paid_at ?? "",
          total: Number(b.total),
          table_code: tableId ? (tableMap.get(tableId) ?? "—") : "—",
          payments: (pays ?? [])
            .filter((p) => p.bill_id === b.id)
            .map((p) => ({ method: p.method, amount: Number(p.amount) })),
        };
      });

      setBills(result);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [range]);
  useEffect(() => { if (range === "custom" && custom?.from && custom?.to) load(); /* eslint-disable-next-line */ }, [custom]);

  const methodChip = (method: string, amount: number) => {
    const cls =
      method === "cash" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" :
      method === "qr"   ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" :
                          "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400";
    const label = method === "qr" ? "QR" : method === "card" ? "Card" : "Cash";
    return (
      <span key={method + amount} className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>
        {label} {thb(amount)}
      </span>
    );
  };

  const customLabel = custom?.from
    ? custom.to && custom.to.getTime() !== custom.from.getTime()
      ? `${format(custom.from, "dd MMM")} – ${format(custom.to, "dd MMM yyyy")}`
      : format(custom.from, "dd MMM yyyy")
    : "Custom range";

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap items-center">
        {(["today","yesterday","week","month"] as const).map((r) => (
          <Button key={r} size="sm" variant={range === r ? "default" : "outline"}
            onClick={() => { setRange(r); }}
          >
            {r === "today" ? "Today" : r === "yesterday" ? "Yesterday" : r === "week" ? "This week" : "This month"}
          </Button>
        ))}
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant={range === "custom" ? "default" : "outline"}
              className={cn(!custom?.from && "text-muted-foreground")}>
              <CalendarIcon className="h-3.5 w-3.5 mr-1" />
              {range === "custom" ? customLabel : "Custom range"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="range" selected={custom}
              onSelect={(r) => { setCustom(r); setRange("custom"); if (r?.from && r?.to) setPickerOpen(false); }}
              numberOfMonths={2} initialFocus className={cn("p-3 pointer-events-auto")} />
          </PopoverContent>
        </Popover>
        {loaded && <span className="text-xs text-muted-foreground ml-1">{bills.length} bill{bills.length !== 1 ? "s" : ""}</span>}
      </div>

      {loaded && (
        bills.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground text-sm">
              No paid bills found for this period
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-1.5">
            {bills.map((b) => (
              <Card key={b.id} className="hover:bg-muted/30 transition-colors">
                <CardContent className="py-3 flex items-center gap-3">
                  <div className="text-xs text-muted-foreground shrink-0 w-24 tabular-nums">
                    <div>{new Date(b.paid_at).toLocaleDateString()}</div>
                    <div>{new Date(b.paid_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                  <span className="font-semibold text-sm shrink-0 w-10">{b.table_code}</span>
                  <span className="font-bold tabular-nums shrink-0 w-24 text-right">{thb(b.total)}</span>
                  <div className="flex gap-1 flex-wrap flex-1 min-w-0">
                    {b.payments.map((p, i) => (
                      <span key={i}>{methodChip(p.method, p.amount)}</span>
                    ))}
                  </div>
                  <Link to="/payment/$billId" params={{ billId: b.id }} className="shrink-0">
                    <Button size="sm" variant="outline">
                      View <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared helper: load cancelled orders for a query
// ---------------------------------------------------------------------------
type CancelledOrderRow = {
  id: string;
  cancel_reason: string | null;
  closed_at: string | null;
  table_code: string;
  total: number;
  item_count: number;
  closed_by_name: string;
  items: { name: string; qty: number; unit_price: number }[];
};

// ---------------------------------------------------------------------------
// Void & Cancelled Orders — current-shift inline section
// ---------------------------------------------------------------------------
function CancelledOrdersSection({ shiftId }: { shiftId: string }) {
  const [orders, setOrders] = useState<CancelledOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data: ords } = await supabase
          .from("orders")
          .select("*")
          .eq("shift_id", shiftId)
          .eq("status", "cancelled")
          .order("closed_at", { ascending: false });

        if (!ords?.length) { setOrders([]); return; }

        const tableIds = [...new Set(ords.map((o) => o.table_id).filter(Boolean))] as string[];
        const staffIds = [...new Set(ords.map((o) => o.closed_by).filter(Boolean))] as string[];

        const [{ data: tables }, { data: staffList }, { data: items }] = await Promise.all([
          tableIds.length
            ? supabase.from("restaurant_tables").select("id,code").in("id", tableIds)
            : Promise.resolve({ data: [] as { id: string; code: string }[], error: null }),
          staffIds.length
            ? supabase.from("staff").select("id,name").in("id", staffIds)
            : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
          supabase.from("order_items").select("order_id,name_th,name_en,qty,unit_price")
            .in("order_id", ords.map((o) => o.id)),
        ]);

        const tableMap = new Map((tables ?? []).map((t) => [t.id, t.code]));
        const staffMap = new Map((staffList ?? []).map((s) => [s.id, s.name]));
        const totalsMap = new Map<string, number>();
        const itemsMap = new Map<string, { name: string; qty: number; unit_price: number }[]>();
        for (const item of items ?? []) {
          totalsMap.set(item.order_id, (totalsMap.get(item.order_id) ?? 0) + item.qty * Number(item.unit_price));
          const arr = itemsMap.get(item.order_id) ?? [];
          arr.push({ name: item.name_th || item.name_en, qty: item.qty, unit_price: Number(item.unit_price) });
          itemsMap.set(item.order_id, arr);
        }

        setOrders(ords.map((o) => ({
          id: o.id,
          cancel_reason: o.cancel_reason,
          closed_at: o.closed_at,
          table_code: o.table_id ? (tableMap.get(o.table_id) ?? "—") : "—",
          total: totalsMap.get(o.id) ?? 0,
          item_count: (itemsMap.get(o.id) ?? []).length,
          closed_by_name: o.closed_by ? (staffMap.get(o.closed_by) ?? "—") : "—",
          items: itemsMap.get(o.id) ?? [],
        })));
      } finally {
        setLoading(false);
      }
    })();
  }, [shiftId]);

  if (loading) return <p className="text-sm text-muted-foreground py-2">Loading cancelled orders…</p>;
  if (!orders.length) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2 text-destructive">
          <XCircle className="h-4 w-4" />
          Void &amp; Cancelled Orders — this shift ({orders.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 pt-0">
        {orders.map((o) => (
          <CancelledOrderCard key={o.id} order={o} expanded={expanded === o.id} onToggle={() => setExpanded(expanded === o.id ? null : o.id)} />
        ))}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Cancelled Orders — full tab (admin / manager only) with date filter
// ---------------------------------------------------------------------------
function CancelledOrdersTab() {
  const [range, setRange] = useState<HistRange>("today");
  const [custom, setCustom] = useState<DateRange | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [orders, setOrders] = useState<CancelledOrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const getBounds = (): [Date, Date] | null => {
    if (range === "custom") {
      if (!custom?.from) return null;
      const s = new Date(custom.from); s.setHours(0, 0, 0, 0);
      const e = new Date(custom.to ?? custom.from); e.setHours(23, 59, 59, 999);
      return [s, e];
    }
    return histBounds(range);
  };

  const load = async () => {
    const bounds = getBounds();
    if (!bounds) return;
    setLoading(true);
    try {
      const [fromDt, toDt] = bounds;
      const { data: ords } = await supabase
        .from("orders")
        .select("id,cancel_reason,closed_at,table_id,closed_by")
        .eq("status", "cancelled")
        .gte("closed_at", fromDt.toISOString())
        .lte("closed_at", toDt.toISOString())
        .order("closed_at", { ascending: false })
        .limit(500);

      if (!ords?.length) { setOrders([]); setLoaded(true); return; }

      const tableIds = [...new Set(ords.map((o) => o.table_id).filter(Boolean))] as string[];
      const staffIds = [...new Set(ords.map((o) => o.closed_by).filter(Boolean))] as string[];

      const [{ data: tables }, { data: staffList }, { data: items }] = await Promise.all([
        tableIds.length
          ? supabase.from("restaurant_tables").select("id,code").in("id", tableIds)
          : Promise.resolve({ data: [] as { id: string; code: string }[], error: null }),
        staffIds.length
          ? supabase.from("staff").select("id,name").in("id", staffIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
        supabase.from("order_items").select("order_id,name_th,name_en,qty,unit_price")
          .in("order_id", ords.map((o) => o.id)),
      ]);

      const tableMap = new Map((tables ?? []).map((t) => [t.id, t.code]));
      const staffMap = new Map((staffList ?? []).map((s) => [s.id, s.name]));
      const totalsMap = new Map<string, number>();
      const itemsMap = new Map<string, { name: string; qty: number; unit_price: number }[]>();
      for (const item of items ?? []) {
        totalsMap.set(item.order_id, (totalsMap.get(item.order_id) ?? 0) + item.qty * Number(item.unit_price));
        const arr = itemsMap.get(item.order_id) ?? [];
        arr.push({ name: item.name_th || item.name_en, qty: item.qty, unit_price: Number(item.unit_price) });
        itemsMap.set(item.order_id, arr);
      }

      setOrders(ords.map((o) => ({
        id: o.id,
        cancel_reason: o.cancel_reason,
        closed_at: o.closed_at,
        table_code: o.table_id ? (tableMap.get(o.table_id) ?? "—") : "—",
        total: totalsMap.get(o.id) ?? 0,
        item_count: (itemsMap.get(o.id) ?? []).length,
        closed_by_name: o.closed_by ? (staffMap.get(o.closed_by) ?? "—") : "—",
        items: itemsMap.get(o.id) ?? [],
      })));
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [range]);
  useEffect(() => { if (range === "custom" && custom?.from && custom?.to) load(); /* eslint-disable-next-line */ }, [custom]);

  const customLabel = custom?.from
    ? custom.to && custom.to.getTime() !== custom.from.getTime()
      ? `${format(custom.from, "dd MMM")} – ${format(custom.to, "dd MMM yyyy")}`
      : format(custom.from, "dd MMM yyyy")
    : "Custom range";

  const grandTotal = orders.reduce((s, o) => s + o.total, 0);

  return (
    <div className="space-y-4">
      {/* Date filter */}
      <div className="flex gap-2 flex-wrap items-center">
        {(["today", "yesterday", "week", "month"] as const).map((r) => (
          <Button key={r} size="sm" variant={range === r ? "default" : "outline"} onClick={() => setRange(r)}>
            {r === "today" ? "Today" : r === "yesterday" ? "Yesterday" : r === "week" ? "This week" : "This month"}
          </Button>
        ))}
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant={range === "custom" ? "default" : "outline"}
              className={cn(!custom?.from && "text-muted-foreground")}>
              <CalendarIcon className="h-3.5 w-3.5 mr-1" />
              {range === "custom" ? customLabel : "Custom range"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="range" selected={custom}
              onSelect={(r) => { setCustom(r); setRange("custom"); if (r?.from && r?.to) setPickerOpen(false); }}
              numberOfMonths={2} initialFocus className={cn("p-3 pointer-events-auto")} />
          </PopoverContent>
        </Popover>
        {loaded && (
          <span className="text-xs text-muted-foreground ml-1">
            {orders.length} order{orders.length !== 1 ? "s" : ""}
            {orders.length > 0 && <> · Total <span className="font-semibold text-destructive">{thb(grandTotal)}</span></>}
          </span>
        )}
      </div>

      {/* Orders list */}
      {loading && <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>}
      {loaded && !loading && (
        orders.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground text-sm">
              No cancelled orders for this period
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-1.5">
            {orders.map((o) => (
              <CancelledOrderCard key={o.id} order={o} expanded={expanded === o.id} onToggle={() => setExpanded(expanded === o.id ? null : o.id)} showDate />
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared cancelled order card (used in both section and tab)
// ---------------------------------------------------------------------------
function CancelledOrderCard({ order: o, expanded, onToggle, showDate }: {
  order: CancelledOrderRow;
  expanded: boolean;
  onToggle: () => void;
  showDate?: boolean;
}) {
  return (
    <Card className="hover:bg-muted/20 transition-colors cursor-pointer" onClick={onToggle}>
      <CardContent className="py-3 space-y-2">
        {/* Summary row */}
        <div className="flex items-center gap-3 text-sm">
          <div className="text-xs text-muted-foreground shrink-0 w-28 tabular-nums">
            {o.closed_at ? (
              <>
                {showDate && <div>{new Date(o.closed_at).toLocaleDateString()}</div>}
                <div>{new Date(o.closed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
              </>
            ) : "—"}
          </div>
          <span className="font-bold shrink-0 w-10">{o.table_code}</span>
          <span className="flex-1 min-w-0 text-xs text-muted-foreground italic truncate">{o.cancel_reason || "—"}</span>
          <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">{o.closed_by_name}</span>
          <span className="text-xs text-muted-foreground shrink-0">{o.item_count} item{o.item_count !== 1 ? "s" : ""}</span>
          <span className="font-bold tabular-nums shrink-0 text-destructive">{thb(o.total)}</span>
        </div>
        {/* Expanded items */}
        {expanded && o.items.length > 0 && (
          <div className="border-t pt-2 space-y-1 text-xs text-muted-foreground">
            {o.items.map((it, i) => (
              <div key={i} className="flex justify-between">
                <span>{it.name} <span className="opacity-70">×{it.qty}</span></span>
                <span className="tabular-nums">{thb(it.qty * it.unit_price)}</span>
              </div>
            ))}
            <div className="flex justify-between font-semibold text-foreground border-t pt-1 mt-1">
              <span>Total</span>
              <span className="tabular-nums text-destructive">{thb(o.total)}</span>
            </div>
            <div className="text-xs mt-1">
              Cancelled by: <span className="font-medium text-foreground">{o.closed_by_name}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DenomGrid({ cashCount, onChange }: { cashCount: Record<number, number>; onChange: (c: Record<number, number>) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {DENOMS.map((d) => {
        const count = cashCount[d] ?? 0;
        return (
          <div key={d} className="rounded-xl border bg-card p-3">
            <div className="text-sm font-semibold text-muted-foreground mb-2">{d}฿</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onChange({ ...cashCount, [d]: Math.max(0, count - 1) })}
                className="h-12 w-12 flex-shrink-0 rounded-lg border bg-muted text-2xl font-bold flex items-center justify-center hover:bg-accent active:scale-95 transition-all select-none"
              >−</button>
              <div className="flex-1 text-center text-2xl font-bold tabular-nums">{count}</div>
              <button
                type="button"
                onClick={() => onChange({ ...cashCount, [d]: count + 1 })}
                className="h-12 w-12 flex-shrink-0 rounded-lg border bg-muted text-2xl font-bold flex items-center justify-center hover:bg-accent active:scale-95 transition-all select-none"
              >+</button>
            </div>
            <div className="text-xs text-muted-foreground text-center mt-1.5">
              {count > 0 ? thb(count * d) : "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CashSummary({ r, cashCount, overShortLabel }: { r: ReportData; cashCount: Record<number, number>; overShortLabel: string }) {
  const { cashTotal, expected, overShort } = calcCashSummary(cashCount, r);
  return (
    <div className="text-sm space-y-1 pt-3 border-t">
      <Row label="Counted" value={thb(cashTotal)} />
      <Row label="Expected" value={thb(expected)} />
      <Row label={overShortLabel} value={thb(overShort)} bold />
    </div>
  );
}

function ReportCard({ r }: { r: ReportData }) {
  return (
    <Card>
      <CardContent className="py-4 space-y-1 text-sm">
        <Row label="Gross sales" value={thb(r.gross)} />
        <Row label="Discount" value={`- ${thb(r.discount)}`} />
        <Row label="Member discount" value={`- ${thb(r.member)}`} />
        <Row label="Net sales" value={thb(r.net)} bold />
        <div className="border-t pt-2 mt-2" />
        <Row label="Cash" value={thb(r.byMethod.cash)} />
        <Row label="QR revenue" value={thb(getQrGrossReceived(r))} />
        {r.tipTotal > 0 && <>
          <Row label="  ↳ Tips collected (QR)" value={thb(r.tipTotal)} />
          <Row label="  ↳ Tips paid out (cash)" value={`- ${thb(r.tipTotal)}`} />
          <Row label="  ↳ Net QR sales" value={thb(getNetQrSales(r))} bold />
        </>}
        <Row label="Credit card" value={thb(r.byMethod.card)} />
        <div className="border-t pt-2 mt-2" />
        <Row label="Voids & Cancellations" value={thb(r.voids)} />
        <Row label="Refunds total" value={thb(r.refunds)} />
        <Row label="Bills" value={String(r.bills)} />
        {r.cancelledCount > 0 && (
          <Row label="Cancelled orders" value={String(r.cancelledCount)} />
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-bold" : ""}`}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}
