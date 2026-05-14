import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n, pickName } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { thb } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, Banknote, QrCode, CreditCard, Printer, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ManagerPinDialog } from "@/components/ManagerPinDialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/payment/$billId")({ component: PaymentPage });

type Bill = {
  id: string; order_id: string; subtotal: number; discount_amount: number;
  member_discount_amount: number; vat_mode: "inclusive" | "exclusive"; vat_rate: number;
  vat_amount: number; total: number; status: string;
};
type Item = { id: string; name_th: string; name_en: string; qty: number; unit_price: number; status: string };
type Payment = { id: string; method: "qr" | "cash" | "card"; amount: number; cash_received: number | null; change_due: number | null };

const DENOMS = [1000, 500, 100, 50, 20, 10, 5, 1];

function PaymentPage() {
  const { billId } = Route.useParams();
  const { t, lang } = useI18n();
  const { staff } = useAuth();
  const nav = useNavigate();

  const [bill, setBill] = useState<Bill | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [discAmt, setDiscAmt] = useState(0);
  const [discPct, setDiscPct] = useState(0);
  const [memberDisc, setMemberDisc] = useState(0);
  const [tableCode, setTableCode] = useState("");
  const [restName, setRestName] = useState("");

  // Cash dialog
  const [cashOpen, setCashOpen] = useState(false);
  const [cashCount, setCashCount] = useState<Record<number, number>>({});
  const [cashAmount, setCashAmount] = useState(0);

  // Refund
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refundAmt, setRefundAmt] = useState(0);
  const [managerOpen, setManagerOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"refund" | null>(null);

  const load = async () => {
    const [{ data: b }, { data: ps }, { data: s }] = await Promise.all([
      supabase.from("bills").select("*").eq("id", billId).single(),
      supabase.from("payments").select("*").eq("bill_id", billId),
      supabase.from("settings").select("restaurant_name").eq("id", 1).single(),
    ]);
    if (b) {
      setBill(b as Bill);
      setDiscAmt(Number(b.discount_amount));
      setMemberDisc(Number(b.member_discount_amount));
      const { data: it } = await supabase.from("order_items").select("*").eq("order_id", b.order_id).neq("status", "voided");
      if (it) setItems(it as Item[]);
      const { data: ord } = await supabase.from("orders").select("table_id").eq("id", b.order_id).single();
      if (ord?.table_id) {
        const { data: tbl } = await supabase.from("restaurant_tables").select("code").eq("id", ord.table_id).single();
        if (tbl) setTableCode(tbl.code);
      }
    }
    if (ps) setPayments(ps as Payment[]);
    if (s) setRestName(s.restaurant_name);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [billId]);

  const subtotal = items.reduce((s, i) => s + i.qty * Number(i.unit_price), 0);
  const pctAmt = (subtotal * discPct) / 100;
  const totalDisc = discAmt + pctAmt;
  const afterDisc = Math.max(0, subtotal - totalDisc - memberDisc);

  let vatAmount = 0;
  let total = afterDisc;
  if (bill) {
    const rate = Number(bill.vat_rate) / 100;
    if (bill.vat_mode === "exclusive") {
      vatAmount = afterDisc * rate;
      total = afterDisc + vatAmount;
    } else {
      // inclusive: VAT is part of price; split it out for display only
      vatAmount = afterDisc - afterDisc / (1 + rate);
      total = afterDisc;
    }
  }

  const paid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Math.max(0, total - paid);

  // Persist updates to bill
  const persistBill = async () => {
    if (!bill) return;
    await supabase.from("bills").update({
      subtotal, discount_amount: totalDisc, member_discount_amount: memberDisc,
      vat_amount: vatAmount, total,
    }).eq("id", bill.id);
  };

  useEffect(() => { persistBill(); /* eslint-disable-next-line */ }, [discAmt, discPct, memberDisc, bill?.id, subtotal]);

  const addPayment = async (method: Payment["method"], amount: number, extras: Record<string, unknown> = {}) => {
    if (!bill || amount <= 0) return;
    await supabase.from("payments").insert({ bill_id: bill.id, method, amount, ...extras });
    await load();
    if (paid + amount + 0.001 >= total) {
      await finalize();
    }
  };

  const finalize = async () => {
    if (!bill) return;
    await supabase.from("bills").update({ status: "paid", paid_at: new Date().toISOString(), cashier_id: staff?.id }).eq("id", bill.id);
    await supabase.from("orders").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", bill.order_id);
    const { data: ord } = await supabase.from("orders").select("table_id").eq("id", bill.order_id).single();
    if (ord?.table_id) {
      await supabase.from("restaurant_tables").update({ status: "available", guests: 0, has_qr_alert: false }).eq("id", ord.table_id);
    }
    // Queue receipt print job
    await supabase.from("print_jobs").insert({
      printer: "counter",
      payload: { kind: "receipt", bill_id: bill.id, restaurant: restName, table: tableCode, items, total, vatAmount, payments: [...payments], language: lang },
    });
    toast.success(t("paid"));
  };

  const openCash = () => {
    setCashCount({});
    setCashAmount(remaining);
    setCashOpen(true);
  };

  const cashTotal = Object.entries(cashCount).reduce((s, [d, c]) => s + Number(d) * (c || 0), 0);
  const change = Math.max(0, cashTotal - cashAmount);

  const submitCash = async () => {
    if (cashTotal < cashAmount) { toast.error("Not enough cash"); return; }
    await addPayment("cash", cashAmount, { cash_received: cashTotal, change_due: change, cash_breakdown: cashCount });
    setCashOpen(false);
  };

  const performRefund = () => {
    if (!refundReason.trim() || refundAmt <= 0) return;
    if (staff?.role === "staff") { setPendingAction("refund"); setManagerOpen(true); return; }
    doRefund();
  };

  const doRefund = async () => {
    if (!bill) return;
    await supabase.from("refunds").insert({ bill_id: bill.id, amount: refundAmt, reason: refundReason, refunded_by: staff?.id });
    await supabase.from("bills").update({ status: "partial_refund" }).eq("id", bill.id);
    setRefundOpen(false); setRefundAmt(0); setRefundReason("");
    toast.success("Refunded");
  };

  const printReceipt = () => {
    window.print();
  };

  if (!bill) return <div className="p-8 text-center text-muted-foreground">{t("loading")}</div>;
  const paidStatus = bill.status === "paid" || bill.status === "partial_refund";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_440px] h-[calc(100vh-3.5rem)]">
      <div className="overflow-auto p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Link to="/pos"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />{t("back")}</Button></Link>
          <h1 className="text-2xl font-bold">{t("payment")} — {tableCode}</h1>
        </div>

        {/* Receipt-style preview */}
        <Card>
          <CardHeader>
            <CardTitle className="text-center">{restName || "Restaurant"}</CardTitle>
            <p className="text-center text-xs text-muted-foreground">{t("table")} {tableCode} · {new Date().toLocaleString(lang === "th" ? "th-TH" : "en-US")}</p>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-b last:border-0">
                    <td className="py-1.5">{pickName(i, lang)}</td>
                    <td className="py-1.5 text-right w-12">{i.qty}</td>
                    <td className="py-1.5 text-right w-24">{thb(i.qty * Number(i.unit_price))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 space-y-1 text-sm">
              <Row label={t("subtotal")} value={thb(subtotal)} />
              {totalDisc > 0 && <Row label={t("discount")} value={`- ${thb(totalDisc)}`} />}
              {memberDisc > 0 && <Row label={t("member_discount")} value={`- ${thb(memberDisc)}`} />}
              {bill.vat_mode === "exclusive" && <Row label={`${t("vat")} ${bill.vat_rate}%`} value={thb(vatAmount)} />}
              <div className="border-t pt-2 mt-2 flex justify-between text-lg font-bold">
                <span>{t("total")}</span><span>{thb(total)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {payments.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Payments</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {payments.map((p) => (
                <Row key={p.id} label={`${p.method.toUpperCase()}${p.cash_received ? ` (rcv ${thb(p.cash_received)}, chg ${thb(p.change_due ?? 0)})` : ""}`} value={thb(p.amount)} />
              ))}
              <Row label="Paid" value={thb(paid)} />
              <Row label="Remaining" value={thb(remaining)} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Right: actions */}
      <aside className="border-l bg-card p-4 overflow-auto">
        {!paidStatus ? (
          <>
            <h3 className="font-semibold mb-2">{t("discount")}</h3>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <Label className="text-xs">{t("amount")}</Label>
                <Input type="number" min={0} value={discAmt} onChange={(e) => setDiscAmt(Math.max(0, Number(e.target.value)))} />
              </div>
              <div>
                <Label className="text-xs">{t("percent")} %</Label>
                <Input type="number" min={0} max={100} value={discPct} onChange={(e) => setDiscPct(Math.max(0, Math.min(100, Number(e.target.value))))} />
              </div>
            </div>
            <Label className="text-xs">{t("member_discount")}</Label>
            <Input type="number" min={0} value={memberDisc} onChange={(e) => setMemberDisc(Math.max(0, Number(e.target.value)))} className="mb-4" />

            <h3 className="font-semibold mb-2">{t("pay")}</h3>
            <Tabs defaultValue="cash">
              <TabsList className="grid grid-cols-3 w-full">
                <TabsTrigger value="cash"><Banknote className="h-4 w-4 mr-1" />{t("cash")}</TabsTrigger>
                <TabsTrigger value="qr"><QrCode className="h-4 w-4 mr-1" />QR</TabsTrigger>
                <TabsTrigger value="card"><CreditCard className="h-4 w-4 mr-1" />{t("card")}</TabsTrigger>
              </TabsList>
              <TabsContent value="cash" className="pt-3">
                <Button className="w-full" size="lg" onClick={openCash} disabled={remaining <= 0}>
                  {t("cash")} · {thb(remaining)}
                </Button>
              </TabsContent>
              <TabsContent value="qr" className="pt-3 space-y-2">
                <Input id="qr-amt" type="number" defaultValue={remaining} step="0.01" />
                <Button className="w-full" size="lg" disabled={remaining <= 0} onClick={() => {
                  const v = Number((document.getElementById("qr-amt") as HTMLInputElement).value);
                  addPayment("qr", v);
                }}>{t("qr_transfer")}</Button>
              </TabsContent>
              <TabsContent value="card" className="pt-3 space-y-2">
                <Input id="card-amt" type="number" defaultValue={remaining} step="0.01" />
                <Button className="w-full" size="lg" disabled={remaining <= 0} onClick={() => {
                  const v = Number((document.getElementById("card-amt") as HTMLInputElement).value);
                  addPayment("card", v);
                }}>{t("card")}</Button>
              </TabsContent>
            </Tabs>
          </>
        ) : (
          <div className="space-y-3">
            <div className="text-center py-4">
              <div className="text-3xl">✅</div>
              <div className="text-xl font-bold mt-2">{t("paid")}</div>
            </div>
            <Button className="w-full" onClick={printReceipt}><Printer className="h-4 w-4 mr-2" />{t("print_receipt")}</Button>
            <Button variant="outline" className="w-full" onClick={() => { setRefundAmt(Number(bill.total)); setRefundOpen(true); }}>
              <RotateCcw className="h-4 w-4 mr-2" />{t("refund")}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => nav({ to: "/pos" })}>{t("back")}</Button>
          </div>
        )}
      </aside>

      {/* Cash dialog */}
      <Dialog open={cashOpen} onOpenChange={setCashOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("cash_received")}</DialogTitle></DialogHeader>
          <div>
            <Label>{t("amount")}</Label>
            <Input type="number" value={cashAmount} onChange={(e) => setCashAmount(Number(e.target.value))} />
          </div>
          <div className="grid grid-cols-4 gap-2">
            {DENOMS.map((d) => (
              <div key={d}>
                <Label className="text-xs">{d}฿</Label>
                <Input type="number" min={0} value={cashCount[d] ?? 0} onChange={(e) => setCashCount({ ...cashCount, [d]: Math.max(0, Number(e.target.value)) })} />
              </div>
            ))}
          </div>
          <div className="text-sm space-y-1 pt-2">
            <Row label={t("cash_received")} value={thb(cashTotal)} />
            <Row label={t("change")} value={thb(change)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCashOpen(false)}>{t("cancel")}</Button>
            <Button onClick={submitCash}>{t("confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refund dialog */}
      <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("refund")}</DialogTitle></DialogHeader>
          <Label>{t("amount")}</Label>
          <Input type="number" value={refundAmt} onChange={(e) => setRefundAmt(Number(e.target.value))} />
          <Label>{t("refund_reason")}</Label>
          <Textarea value={refundReason} onChange={(e) => setRefundReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundOpen(false)}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={performRefund}>{t("confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ManagerPinDialog open={managerOpen} onOpenChange={setManagerOpen} onApproved={() => { if (pendingAction === "refund") doRefund(); setPendingAction(null); }} />
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span><span className="font-medium">{value}</span>
    </div>
  );
}
