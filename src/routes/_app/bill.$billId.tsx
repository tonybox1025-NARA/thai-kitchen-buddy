import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { bkkDateTime } from "@/lib/bkk-time";
import { thb } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { localizeError } from "@/lib/localized-error";

export const Route = createFileRoute("/_app/bill/$billId")({ component: BillDetailPage });

type BillDetail = {
  id: string;
  order_id: string;
  receipt_number: string | null;
  paid_at: string | null;
  status: "paid" | "partial_refund" | "refunded";
  subtotal: number;
  discount_amount: number;
  member_discount_amount: number;
  loyalty_discount_amount: number;
  points_redeemed: number;
  service_fee_amount: number;
  vat_amount: number;
  rounding_adjustment: number;
  total: number;
};

type OrderItem = {
  id: string;
  name_th: string;
  name_en: string;
  qty: number;
  unit_price: number;
  notes: string | null;
};

type Payment = {
  id: string;
  method: string;
  amount: number;
  tip_amount: number;
  reference: string | null;
  cash_received: number | null;
  change_due: number | null;
  created_at: string;
};

type Refund = {
  id: string;
  amount: number;
  payout_method: string;
  reason: string;
  created_at: string;
};

type LoadedBill = {
  bill: BillDetail;
  items: OrderItem[];
  payments: Payment[];
  refunds: Refund[];
  table: string;
};

function paymentName(method: string, lang: string) {
  if (method === "cash") return lang === "th" ? "เงินสด" : "Cash";
  if (method === "qr") return "QR Transfer";
  if (method === "gov_qr") return "60/40 Payment";
  if (method === "card") return lang === "th" ? "บัตรเครดิต" : "Credit card";
  return method;
}

function statusName(status: BillDetail["status"], lang: string) {
  if (status === "refunded") return lang === "th" ? "คืนเงินแล้ว" : "Refunded";
  if (status === "partial_refund") return lang === "th" ? "คืนเงินบางส่วน" : "Partially refunded";
  return lang === "th" ? "ชำระแล้ว" : "Paid";
}

function SummaryRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 ${strong ? "border-t pt-3 text-lg font-bold" : "text-sm"}`}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

function BillDetailPage() {
  const { billId } = Route.useParams();
  const { lang } = useI18n();
  const [data, setData] = useState<LoadedBill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const copy = (th: string, en: string) => (lang === "th" ? th : en);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const { data: billRow, error: billError } = await supabase
          .from("bills")
          .select(
            "id,order_id,receipt_number,paid_at,status,subtotal,discount_amount,member_discount_amount,loyalty_discount_amount,points_redeemed,service_fee_amount,vat_amount,rounding_adjustment,total",
          )
          .eq("id", billId)
          .not("is_test", "is", true)
          .in("status", ["paid", "partial_refund", "refunded"])
          .maybeSingle();
        if (billError) throw billError;
        if (!billRow) {
          throw new Error(lang === "th" ? "ไม่พบบิลที่ชำระแล้ว" : "Paid Bill not found");
        }

        const [
          { data: items, error: itemsError },
          { data: payments, error: paymentsError },
          { data: refunds, error: refundsError },
          { data: order, error: orderError },
        ] = await Promise.all([
          supabase
            .from("order_items")
            .select("id,name_th,name_en,qty,unit_price,notes")
            .eq("order_id", billRow.order_id)
            .neq("status", "voided")
            .order("created_at"),
          supabase
            .from("payments")
            .select("id,method,amount,tip_amount,reference,cash_received,change_due,created_at")
            .eq("bill_id", billRow.id)
            .order("created_at"),
          supabase
            .from("refunds")
            .select("id,amount,payout_method,reason,created_at")
            .eq("bill_id", billRow.id)
            .order("created_at"),
          supabase
            .from("orders")
            .select("table_id,source,order_number")
            .eq("id", billRow.order_id)
            .maybeSingle(),
        ]);
        if (itemsError) throw itemsError;
        if (paymentsError) throw paymentsError;
        if (refundsError) throw refundsError;
        if (orderError) throw orderError;

        let table = order?.order_number || "—";
        if (order?.table_id) {
          const { data: tableRow, error: tableError } = await supabase
            .from("restaurant_tables")
            .select("code")
            .eq("id", order.table_id)
            .maybeSingle();
          if (tableError) throw tableError;
          table = tableRow?.code ?? table;
        }

        if (active) {
          setData({
            bill: billRow as BillDetail,
            items: (items ?? []) as OrderItem[],
            payments: (payments ?? []) as Payment[],
            refunds: (refunds ?? []) as Refund[],
            table,
          });
        }
      } catch (loadError) {
        if (active) setError(localizeError(loadError, lang, "load"));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [billId, lang]);

  if (loading) {
    return (
      <div className="p-8 text-center text-muted-foreground">{copy("กำลังโหลด…", "Loading…")}</div>
    );
  }

  if (!data || error) {
    return (
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <Link to="/reports">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" />
            {copy("กลับไปประวัติบิล", "Back to Bill History")}
          </Button>
        </Link>
        <Card>
          <CardContent className="py-12 text-center text-destructive">
            {error || copy("ไม่พบบิล", "Bill not found")}
          </CardContent>
        </Card>
      </main>
    );
  }

  const { bill, items, payments, refunds, table } = data;
  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/reports">
            <Button variant="ghost" size="sm" className="-ml-3 mb-1">
              <ArrowLeft className="mr-1 h-4 w-4" />
              {copy("ประวัติบิล", "Bill History")}
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <ReceiptText className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">
              {bill.receipt_number ?? copy("รายละเอียดบิล", "Bill details")}
            </h1>
          </div>
        </div>
        <Badge variant={bill.status === "paid" ? "secondary" : "outline"}>
          {statusName(bill.status, lang)}
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">{copy("วันที่ชำระ", "Paid at")}</p>
            <p className="mt-1 font-semibold">{bkkDateTime(bill.paid_at, lang)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">
              {copy("โต๊ะ / ออเดอร์", "Table / order")}
            </p>
            <p className="mt-1 font-semibold">{table}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">{copy("ยอดสุทธิ", "Net total")}</p>
            <p className="mt-1 text-xl font-bold">{thb(bill.total)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{copy("รายการอาหาร", "Order items")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="grid grid-cols-[auto_1fr_auto] gap-3 border-b pb-3 last:border-0 last:pb-0"
            >
              <span className="font-semibold tabular-nums">{item.qty}×</span>
              <div>
                <p className="font-medium">
                  {lang === "th" ? item.name_th : item.name_en || item.name_th}
                </p>
                {item.notes && <p className="mt-1 text-xs text-muted-foreground">{item.notes}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  {thb(item.unit_price)} × {item.qty}
                </p>
              </div>
              <span className="font-semibold tabular-nums">
                {thb(Number(item.unit_price) * item.qty)}
              </span>
            </div>
          ))}
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {copy("ไม่มีรายการอาหาร", "No order items")}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{copy("สรุปยอด", "Bill summary")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <SummaryRow label={copy("ยอดก่อนส่วนลด", "Subtotal")} value={thb(bill.subtotal)} />
            {Number(bill.discount_amount) > 0 && (
              <SummaryRow
                label={copy("ส่วนลด", "Discount")}
                value={`-${thb(bill.discount_amount)}`}
              />
            )}
            {Number(bill.member_discount_amount) > 0 && (
              <SummaryRow
                label={copy("ส่วนลดสมาชิก", "Member discount")}
                value={`-${thb(bill.member_discount_amount)}`}
              />
            )}
            {Number(bill.loyalty_discount_amount) > 0 && (
              <SummaryRow
                label={`${copy("ใช้คะแนน", "Points used")} (${Number(bill.points_redeemed).toLocaleString()})`}
                value={`-${thb(bill.loyalty_discount_amount)}`}
              />
            )}
            {Number(bill.service_fee_amount) !== 0 && (
              <SummaryRow
                label={copy("ค่าบริการ", "Service fee")}
                value={thb(bill.service_fee_amount)}
              />
            )}
            {Number(bill.vat_amount) !== 0 && (
              <SummaryRow label="VAT" value={thb(bill.vat_amount)} />
            )}
            {Number(bill.rounding_adjustment) !== 0 && (
              <SummaryRow
                label={copy("ปัดเศษ", "Rounding")}
                value={thb(bill.rounding_adjustment)}
              />
            )}
            <SummaryRow label={copy("ยอดสุทธิ", "Total")} value={thb(bill.total)} strong />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{copy("การชำระเงิน", "Payments")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {payments.map((payment) => (
              <div key={payment.id} className="space-y-2 border-b pb-4 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-semibold">{paymentName(payment.method, lang)}</span>
                  <span className="font-bold tabular-nums">{thb(payment.amount)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {bkkDateTime(payment.created_at, lang)}
                </p>
                {Number(payment.tip_amount) > 0 && (
                  <SummaryRow label={copy("ทิป", "Tip")} value={thb(payment.tip_amount)} />
                )}
                {payment.method === "cash" && payment.cash_received !== null && (
                  <SummaryRow
                    label={copy("รับเงิน", "Cash received")}
                    value={thb(payment.cash_received)}
                  />
                )}
                {payment.method === "cash" && payment.change_due !== null && (
                  <SummaryRow label={copy("เงินทอน", "Change")} value={thb(payment.change_due)} />
                )}
                {payment.reference && (
                  <p className="break-all text-xs text-muted-foreground">
                    {copy("อ้างอิง", "Reference")}: {payment.reference}
                  </p>
                )}
              </div>
            ))}
            {payments.length === 0 && (
              <p className="text-sm text-destructive">
                {copy("ไม่พบข้อมูลการชำระเงิน", "No payment record found")}
              </p>
            )}
            {refunds.map((refund) => (
              <div
                key={refund.id}
                className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/20"
              >
                <div className="flex justify-between gap-3 font-semibold">
                  <span>
                    {copy("คืนเงิน", "Refund")} · {paymentName(refund.payout_method, lang)}
                  </span>
                  <span>-{thb(refund.amount)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {bkkDateTime(refund.created_at, lang)} · {refund.reason}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
