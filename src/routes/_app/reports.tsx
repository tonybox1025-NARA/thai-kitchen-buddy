import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { thb } from "@/lib/format";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ManagerPinDialog } from "@/components/ManagerPinDialog";

export const Route = createFileRoute("/_app/reports")({ component: Reports });

const DENOMS = [1000, 500, 100, 50, 20, 10, 5, 1];

type Shift = { id: string; business_day: string; opened_at: string; closed_at: string | null; opening_float: number; status: "open" | "closed" };
type ReportData = {
  gross: number; net: number; discount: number; member: number;
  voids: number; refunds: number; byMethod: Record<string, number>;
  openingFloat: number; bills: number;
  tipTotal: number; // sum of tip_amount on QR payments — collected via QR, paid out in cash
};

function calcCashSummary(cashCount: Record<number, number>, r: ReportData) {
  const cashTotal = Object.entries(cashCount).reduce((s, [d, c]) => s + Number(d) * (c || 0), 0);
  // Tips are received via QR but paid out from the cash drawer, so subtract from expected cash.
  const expected = r.openingFloat + r.byMethod.cash - r.tipTotal;
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
${row("QR revenue", thb(r.byMethod.qr))}
${r.tipTotal > 0 ? row("  Tips collected (QR)", thb(r.tipTotal)) : ""}
${r.tipTotal > 0 ? row("  Tips paid out (cash)", `- ${thb(r.tipTotal)}`) : ""}
${r.tipTotal > 0 ? row("  Net QR sales", thb(r.byMethod.qr - r.tipTotal), true) : ""}
${row("Credit card", thb(r.byMethod.card))}
</table>
<h2>Other</h2><table>
${row("Voids total", thb(r.voids))}
${row("Refunds total", thb(r.refunds))}
${row("Bills", String(r.bills))}
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
    const { data: pays } = billIds.length
      ? await supabase.from("payments").select("method,amount,tip_amount").in("bill_id", billIds)
      : { data: [] as { method: string; amount: number; tip_amount: number }[] };
    const { data: voids } = await supabase.from("voids").select("amount").eq("shift_id", s.id);
    const { data: refunds } = await supabase.from("refunds").select("amount").eq("shift_id", s.id);
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
    const expected = report.openingFloat + report.byMethod.cash - report.tipTotal;
    const overShort = cashTotal - expected;
    await supabase.from("shifts").update({
      closed_at: new Date().toISOString(), closed_by: staff?.id, status: "closed",
      cash_count: cashCount, totals: { ...report, cashTotal, expected, overShort },
    }).eq("id", shift.id);
    const next = new Date(); next.setDate(next.getDate() + 1);
    await supabase.from("settings").update({ current_business_day: next.toISOString().slice(0, 10) }).eq("id", 1);
    setZDlg(false); setShift(null); setReport(null);
    toast.success("Z report saved · day closed");
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">{t("nav_reports")}</h1>

      {!shift ? (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <p className="text-muted-foreground">{t("no_open_shift")}</p>
            <p className="text-sm text-muted-foreground">Open a shift from the Shift button above</p>
          </CardContent>
        </Card>
      ) : (
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
      )}

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

      <ManagerPinDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        onApproved={() => { if (pendingZ) doZ(); setPendingZ(false); }}
      />
    </div>
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
        <Row label="QR revenue" value={thb(r.byMethod.qr)} />
        {r.tipTotal > 0 && <>
          <Row label="  ↳ Tips collected (QR)" value={thb(r.tipTotal)} />
          <Row label="  ↳ Tips paid out (cash)" value={`- ${thb(r.tipTotal)}`} />
          <Row label="  ↳ Net QR sales" value={thb(r.byMethod.qr - r.tipTotal)} bold />
        </>}
        <Row label="Credit card" value={thb(r.byMethod.card)} />
        <div className="border-t pt-2 mt-2" />
        <Row label="Voids total" value={thb(r.voids)} />
        <Row label="Refunds total" value={thb(r.refunds)} />
        <Row label="Bills" value={String(r.bills)} />
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
