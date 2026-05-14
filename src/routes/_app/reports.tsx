import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [cashCount, setCashCount] = useState<Record<number, number>>({});
  const [managerOpen, setManagerOpen] = useState(false);
  const [pendingZ, setPendingZ] = useState(false);

  const loadShift = async () => {
    const { data } = await supabase.from("shifts").select("*").eq("status", "open").maybeSingle();
    setShift((data as Shift) ?? null);
  };

  useEffect(() => { loadShift(); }, []);

  const openShift = async () => {
    if (!staff) return;
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from("shifts").insert({ business_day: today, opened_by: staff.id, opening_float: opening });
    setOpenShiftDlg(false); setOpening(0);
    loadShift();
  };

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
    const r = await buildReport(shift);
    setReport(r);
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
    // Advance business day on settings
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
            <Button size="lg" onClick={() => setOpenShiftDlg(true)}>{t("open_shift")}</Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t("shift")} · {t("business_day")}: {shift.business_day}</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-3">
            <Button onClick={runX} variant="outline">{t("x_report")}</Button>
            <Button onClick={startZ} variant="destructive">{t("z_report")}</Button>
          </CardContent>
        </Card>
      )}

      {report && !zDlg && <ReportCard r={report} />}

      <Dialog open={openShiftDlg} onOpenChange={setOpenShiftDlg}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("open_shift")}</DialogTitle></DialogHeader>
          <Label>{t("opening_float")}</Label>
          <Input type="number" value={opening} onChange={(e) => setOpening(Number(e.target.value))} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenShiftDlg(false)}>{t("cancel")}</Button>
            <Button onClick={openShift}>{t("confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={zDlg} onOpenChange={setZDlg}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{t("z_report")} — {t("cash_count")}</DialogTitle></DialogHeader>
          {report && <ReportCard r={report} compact />}
          <div className="grid grid-cols-4 gap-2">
            {DENOMS.map((d) => (
              <div key={d}>
                <Label className="text-xs">{d}฿</Label>
                <Input type="number" min={0} value={cashCount[d] ?? 0} onChange={(e) => setCashCount({ ...cashCount, [d]: Number(e.target.value) })} />
              </div>
            ))}
          </div>
          {report && (() => {
            const cashTotal = Object.entries(cashCount).reduce((s, [d, c]) => s + Number(d) * (c || 0), 0);
            const expected = report.openingFloat + report.byMethod.cash;
            const overShort = cashTotal - expected;
            return (
              <div className="text-sm space-y-1 pt-2">
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
