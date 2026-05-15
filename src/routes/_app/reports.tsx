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

function Reports() {
  const { staff } = useAuth();
  const { t } = useI18n();
  const [shift, setShift] = useState<Shift | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [zDlg, setZDlg] = useState(false);
  const [xDlg, setXDlg] = useState(false);
  const [cashCount, setCashCount] = useState<Record<number, number>>({});
  const [xCashCount, setXCashCount] = useState<Record<number, number>>({});
  const [managerOpen, setManagerOpen] = useState(false);
  const [pendingZ, setPendingZ] = useState(false);
  const [xLoading, setXLoading] = useState(false);

  const loadShift = async () => {
    const { data } = await supabase.from("shifts").select("*").eq("status", "open").maybeSingle();
    setShift((data as Shift) ?? null);
  };

  useEffect(() => { loadShift(); }, []);

  const buildReport = async (s: Shift): Promise<ReportData> => {
    const { data: bills } = await supabase.from("bills").select("id,total,subtotal,discount_amount,member_discount_amount").eq("shift_id", s.id).eq("status", "paid");
    const billIds = (bills ?? []).map((b) => b.id);
    const { data: pays } = billIds.length
      ? await supabase.from("payments").select("method,amount").in("bill_id", billIds)
      : { data: [] as { method: string; amount: number }[] };
    const { data: voids } = await supabase.from("voids").select("amount").eq("shift_id", s.id);
    const { data: refunds } = await supabase.from("refunds").select("amount").eq("shift_id", s.id);
    const gross = (bills ?? []).reduce((x, b) => x + Number(b.subtotal), 0);
    const net = (bills ?? []).reduce((x, b) => x + Number(b.total), 0);
    const discount = (bills ?? []).reduce((x, b) => x + Number(b.discount_amount), 0);
    const member = (bills ?? []).reduce((x, b) => x + Number(b.member_discount_amount), 0);
    const byMethod: Record<string, number> = { cash: 0, qr: 0, card: 0 };
    (pays ?? []).forEach((p) => { byMethod[p.method] = (byMethod[p.method] ?? 0) + Number(p.amount); });
    return {
      gross, net, discount, member,
      voids: (voids ?? []).reduce((x, v) => x + Number(v.amount), 0),
      refunds: (refunds ?? []).reduce((x, v) => x + Number(v.amount), 0),
      byMethod, openingFloat: Number(s.opening_float), bills: (bills ?? []).length,
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
    } catch (e) {
      toast.error("Failed to load report");
    } finally {
      setXLoading(false);
    }
  };

  const printX = () => {
    if (!shift || !report) return;
    const { cashTotal, expected, overShort } = (() => {
      const t = Object.entries(xCashCount).reduce((s, [d, c]) => s + Number(d) * (c || 0), 0);
      const e = report.openingFloat + report.byMethod.cash;
      return { cashTotal: t, expected: e, overShort: t - e };
    })();
    const row = (l: string, v: string) => `<tr><td>${l}</td><td style="text-align:right">${v}</td></tr>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>X Report</title>
      <style>body{font-family:ui-sans-serif,system-ui;padding:24px;max-width:480px;margin:auto}h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:16px 0 4px;border-bottom:1px solid #ccc;padding-bottom:2px}table{width:100%;border-collapse:collapse;font-size:13px}td{padding:2px 0}.b{font-weight:700}</style>
      </head><body>
      <h1>X Report</h1>
      <div>Business day: ${shift.business_day}</div>
      <div>Printed: ${new Date().toLocaleString()}</div>
      <h2>Sales</h2><table>
      ${row("Gross sales", thb(report.gross))}
      ${row("Discount", `- ${thb(report.discount)}`)}
      ${row("Member discount", `- ${thb(report.member)}`)}
      <tr class="b">${row("Net sales", thb(report.net)).replace(/<\/?tr>/g, "")}</tr>
      </table>
      <h2>Payments</h2><table>
      ${row("Cash", thb(report.byMethod.cash))}
      ${row("QR Transfer", thb(report.byMethod.qr))}
      ${row("Credit card", thb(report.byMethod.card))}
      </table>
      <h2>Other</h2><table>
      ${row("Voids total", thb(report.voids))}
      ${row("Refunds total", thb(report.refunds))}
      ${row("Bills", String(report.bills))}
      </table>
      <h2>Cash drawer</h2><table>
      ${row("Opening float", thb(report.openingFloat))}
      ${row("Counted", thb(cashTotal))}
      ${row("Expected", thb(expected))}
      ${row("Over / Short", thb(overShort))}
      </table>
      <script>window.onload=()=>window.print()</script>
      </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
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
    const next = new Date(); next.setDate(next.getDate() + 1);
    await supabase.from("settings").update({ current_business_day: next.toISOString().slice(0, 10) }).eq("id", 1);
    setZDlg(false); setShift(null); setReport(null);
    toast.success("Z report saved · day closed");
  };

  const cashSummary = (r: ReportData, counts: Record<number, number>) => {
    const cashTotal = Object.entries(counts).reduce((s, [d, c]) => s + Number(d) * (c || 0), 0);
    const expected = r.openingFloat + r.byMethod.cash;
    return { cashTotal, expected, overShort: cashTotal - expected };
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
            <Button onClick={runX} variant="outline" disabled={xLoading}>{xLoading ? "Loading…" : t("x_report")}</Button>
            <Button onClick={startZ} variant="destructive">{t("z_report")}</Button>
          </CardContent>
        </Card>
      )}

      {/* X Report: sales summary + inline cash count */}
      {report && !zDlg && (
        <>
          <ReportCard r={report} />
          <Card>
            <CardHeader><CardTitle className="text-base">{t("cash_count")}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <DenomGrid cashCount={cashCount} onChange={setCashCount} />
              {(() => {
                const { cashTotal, expected, overShort } = cashSummary(report);
                return (
                  <div className="text-sm space-y-1 pt-2 border-t">
                    <Row label="Counted" value={thb(cashTotal)} />
                    <Row label="Expected" value={thb(expected)} />
                    <Row label={t("over_short")} value={thb(overShort)} />
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </>
      )}

      {/* Z Report dialog: compact summary + inline cash count + close shift */}
      <Dialog open={zDlg} onOpenChange={setZDlg}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{t("z_report")} — {t("cash_count")}</DialogTitle></DialogHeader>
          {report && <ReportCard r={report} compact />}
          <DenomGrid cashCount={cashCount} onChange={setCashCount} />
          {report && (() => {
            const { cashTotal, expected, overShort } = cashSummary(report);
            return (
              <div className="text-sm space-y-1 pt-2 border-t">
                <Row label="Counted" value={thb(cashTotal)} />
                <Row label="Expected" value={thb(expected)} />
                <Row label={t("over_short")} value={thb(overShort)} />
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setZDlg(false)}>{t("cancel")}</Button>
            <Button onClick={submitZ}>{t("close_shift")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ManagerPinDialog open={managerOpen} onOpenChange={setManagerOpen} onApproved={() => { if (pendingZ) doZ(); setPendingZ(false); }} />
    </div>
  );
}

type ReportData = {
  gross: number; net: number; discount: number; member: number;
  voids: number; refunds: number; byMethod: Record<string, number>;
  openingFloat: number; bills: number;
};

function DenomGrid({ cashCount, onChange }: { cashCount: Record<number, number>; onChange: (c: Record<number, number>) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {DENOMS.map((d) => {
        const count = cashCount[d] ?? 0;
        return (
          <label key={d} className="block rounded-lg border bg-card p-2 cursor-text hover:border-primary transition-colors">
            <div className="text-xs text-muted-foreground font-medium">{d}฿</div>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={count === 0 ? "" : count}
              placeholder="0"
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const v = e.target.value === "" ? 0 : Math.max(0, parseInt(e.target.value.replace(/\D/g, "")) || 0);
                onChange({ ...cashCount, [d]: v });
              }}
              className="block w-full bg-transparent text-2xl font-bold outline-none mt-0.5"
            />
            <div className="text-xs text-muted-foreground mt-0.5">
              {count > 0 ? `= ${thb(count * d)}` : "—"}
            </div>
          </label>
        );
      })}
    </div>
  );
}

function ReportCard({ r, compact }: { r: ReportData; compact?: boolean }) {
  return (
    <Card>
      <CardContent className={compact ? "py-3 text-sm space-y-1" : "py-6 space-y-1"}>
        <Row label="Gross sales" value={thb(r.gross)} />
        <Row label="Discount" value={`- ${thb(r.discount)}`} />
        <Row label="Member discount" value={`- ${thb(r.member)}`} />
        <Row label="Net sales" value={thb(r.net)} bold />
        <div className="border-t pt-2 mt-2" />
        <Row label="Cash" value={thb(r.byMethod.cash)} />
        <Row label="QR Transfer" value={thb(r.byMethod.qr)} />
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
  return <div className={`flex justify-between ${bold ? "font-bold text-base" : ""}`}><span>{label}</span><span>{value}</span></div>;
}
