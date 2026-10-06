import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Download, Printer, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { printCounter } from "@/lib/counter-printer";
import { thb } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { localizeError } from "@/lib/localized-error";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app/receipts")({ component: ReceiptsPage });

type CustomerType = "individual" | "company";
type BuyerForm = {
  customer_type: CustomerType;
  customer_name: string;
  customer_address: string;
  customer_tax_id: string;
  customer_branch_label: string;
  customer_branch_number: string;
  customer_email: string;
  customer_phone: string;
};
type Bill = {
  id: string;
  order_id: string;
  receipt_number: string;
  paid_at: string;
  subtotal: number;
  discount_amount: number;
  member_discount_amount: number;
  loyalty_discount_amount: number;
  service_fee_amount: number;
  vat_amount: number;
  rounding_adjustment: number;
  total: number;
};
type ReceiptItem = {
  id: string;
  name_th: string;
  name_en: string;
  qty: number;
  unit_price: number;
  notes: string | null;
};
type Payment = {
  method: string;
  amount: number;
  cash_received: number | null;
  change_due: number | null;
};
type Seller = {
  restaurant_name: string;
  legal_name_th: string;
  legal_name_en: string;
  address: string;
  business_tax_id: string;
  business_branch_label: string;
  business_branch_number: string;
  vat_registered: boolean;
  receipt_logo_url: string | null;
};
type ReceiptRecord = BuyerForm & { id: string };
type LoadedReceipt = {
  bill: Bill;
  items: ReceiptItem[];
  payments: Payment[];
  table: string;
  seller: Seller;
  record: ReceiptRecord | null;
};

const emptyBuyer: BuyerForm = {
  customer_type: "individual",
  customer_name: "",
  customer_address: "",
  customer_tax_id: "",
  customer_branch_label: "Head Office / สำนักงานใหญ่",
  customer_branch_number: "00000",
  customer_email: "",
  customer_phone: "",
};

function cleanReceiptNumber(value: string) {
  return value
    .trim()
    .replace(/[\s-]+/g, "")
    .toUpperCase();
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );
}

function paymentName(method: string) {
  if (method === "cash") return "เงินสด / Cash";
  if (method === "qr") return "QR Transfer";
  if (method === "gov_qr") return "60/40 Payment";
  if (method === "card") return "บัตรเครดิต / Credit card";
  return method;
}

function receiptHtml(data: LoadedReceipt, buyer: BuyerForm) {
  const { bill, seller } = data;
  const discount =
    Number(bill.discount_amount) +
    Number(bill.member_discount_amount) +
    Number(bill.loyalty_discount_amount);
  const rows = data.items
    .map(
      (item) => `
    <tr><td>${escapeHtml(item.name_th || item.name_en)}${item.notes ? `<div class="note">${escapeHtml(item.notes)}</div>` : ""}</td>
    <td class="num">${Number(item.qty)}</td><td class="num">${Number(item.unit_price).toFixed(2)}</td>
    <td class="num">${(Number(item.qty) * Number(item.unit_price)).toFixed(2)}</td></tr>`,
    )
    .join("");
  const payments = data.payments
    .map(
      (payment) => `
    <div class="line"><span>${escapeHtml(paymentName(payment.method))}</span><span>฿${Number(payment.amount).toFixed(2)}</span></div>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(bill.receipt_number)}</title>
  <style>
    @page{size:A4;margin:16mm}*{box-sizing:border-box}body{margin:0;color:#111;font-family:Arial,"Noto Sans Thai",sans-serif;font-size:13px}
    .page{max-width:180mm;margin:auto}.center{text-align:center}.title{font-size:22px;font-weight:800;margin:10px 0 4px}.legal{font-size:16px;font-weight:700}
    .muted{color:#555}.notice{margin:12px 0;padding:8px;border:1px solid #777;text-align:center;font-weight:700}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:16px 0}
    .box{border:1px solid #bbb;border-radius:6px;padding:10px;min-height:100px}.box h3{margin:0 0 7px;font-size:13px}.line{display:flex;justify-content:space-between;gap:12px;margin:4px 0}
    table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border-bottom:1px solid #ccc;padding:7px 5px;text-align:left}.num{text-align:right;white-space:nowrap}.note{font-size:11px;color:#555}
    .totals{margin:12px 0 0 auto;width:76mm}.total{font-size:17px;font-weight:800;border-top:2px solid #111;padding-top:7px}.footer{margin-top:28px;text-align:center}.no-print{margin:18px 0;text-align:center}
    @media print{.no-print{display:none}.page{max-width:none}}
  </style></head><body><div class="page">
    <div class="center"><div class="title">ใบเสร็จรับเงิน / RECEIPT</div><div class="legal">${escapeHtml(seller.legal_name_th)}</div><div class="legal">${escapeHtml(seller.legal_name_en)}</div>
    <div>${escapeHtml(seller.address)}</div><div>เลขประจำตัวผู้เสียภาษี / Tax ID: ${escapeHtml(seller.business_tax_id)}</div><div>${escapeHtml(seller.business_branch_label)} — ${escapeHtml(seller.business_branch_number)}</div></div>
    <div class="notice">ยังไม่ได้จดทะเบียน VAT — เอกสารนี้เป็นใบเสร็จรับเงิน ไม่ใช่ใบกำกับภาษี<br>NOT VAT REGISTERED — THIS RECEIPT IS NOT A TAX INVOICE</div>
    <div class="grid"><div class="box"><h3>ข้อมูลลูกค้า / CUSTOMER</h3><div><b>${escapeHtml(buyer.customer_name)}</b></div><div>${escapeHtml(buyer.customer_address)}</div>
      ${buyer.customer_tax_id ? `<div>Tax ID: ${escapeHtml(buyer.customer_tax_id)}</div>` : ""}
      ${buyer.customer_type === "company" ? `<div>${escapeHtml(buyer.customer_branch_label)} ${escapeHtml(buyer.customer_branch_number)}</div>` : ""}
      ${buyer.customer_email ? `<div>Email: ${escapeHtml(buyer.customer_email)}</div>` : ""}${buyer.customer_phone ? `<div>Tel: ${escapeHtml(buyer.customer_phone)}</div>` : ""}</div>
    <div class="box"><h3>รายละเอียดใบเสร็จ / RECEIPT DETAILS</h3><div class="line"><span>เลขที่ / No.</span><b>${escapeHtml(bill.receipt_number)}</b></div>
      <div class="line"><span>วันที่ / Date</span><span>${escapeHtml(new Date(bill.paid_at).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" }))}</span></div>
      <div class="line"><span>โต๊ะ / Table</span><span>${escapeHtml(data.table)}</span></div></div></div>
    <table><thead><tr><th>รายการ / Description</th><th class="num">จำนวน / Qty</th><th class="num">ราคา / Price</th><th class="num">รวม / Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="totals"><div class="line"><span>ยอดก่อนส่วนลด / Subtotal</span><span>฿${Number(bill.subtotal).toFixed(2)}</span></div>
      ${discount ? `<div class="line"><span>ส่วนลด / Discount</span><span>-฿${discount.toFixed(2)}</span></div>` : ""}
      ${Number(bill.service_fee_amount) ? `<div class="line"><span>ค่าบริการ / Service</span><span>฿${Number(bill.service_fee_amount).toFixed(2)}</span></div>` : ""}
      ${Number(bill.rounding_adjustment) ? `<div class="line"><span>ปัดเศษ / Rounding</span><span>฿${Number(bill.rounding_adjustment).toFixed(2)}</span></div>` : ""}
      <div class="line total"><span>ยอดสุทธิ / TOTAL</span><span>฿${Number(bill.total).toFixed(2)}</span></div><div style="margin-top:8px">${payments}</div></div>
    <div class="footer">ขอบคุณค่ะ / Thank you</div>
    <div class="no-print"><button onclick="window.print()">Print / Save PDF</button></div>
  </div></body></html>`;
}

function writePrintWindow(printWindow: Window, html: string) {
  printWindow.opener = null;
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 250);
}

function ReceiptsPage() {
  const { lang } = useI18n();
  const { staff } = useAuth();
  const [query, setQuery] = useState("");
  const [data, setData] = useState<LoadedReceipt | null>(null);
  const [buyer, setBuyer] = useState<BuyerForm>(emptyBuyer);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const copy = (th: string, en: string) => (lang === "th" ? th : en);

  const search = async () => {
    const receiptNumber = cleanReceiptNumber(query);
    if (!receiptNumber) return;
    setLoading(true);
    try {
      const { data: billRow, error } = await supabase
        .from("bills")
        .select("*")
        .eq("receipt_number", receiptNumber)
        .not("is_test", "is", true)
        .in("status", ["paid", "partial_refund", "refunded"])
        .maybeSingle();
      if (error) throw error;
      if (!billRow) {
        setData(null);
        toast.error(copy("ไม่พบเลขที่ใบเสร็จนี้", "Receipt number not found"));
        return;
      }

      const [
        { data: items },
        { data: payments },
        { data: order },
        { data: settings },
        { data: document },
      ] = await Promise.all([
        supabase
          .from("order_items")
          .select("id,name_th,name_en,qty,unit_price,notes")
          .eq("order_id", billRow.order_id)
          .neq("status", "voided")
          .order("created_at"),
        supabase
          .from("payments")
          .select("method,amount,cash_received,change_due")
          .eq("bill_id", billRow.id)
          .order("created_at"),
        supabase.from("orders").select("table_id").eq("id", billRow.order_id).single(),
        supabase
          .from("settings")
          .select(
            "restaurant_name,legal_name_th,legal_name_en,address,business_tax_id,business_branch_label,business_branch_number,vat_registered,receipt_logo_url",
          )
          .eq("id", 1)
          .single(),
        supabase.from("receipt_documents").select("*").eq("bill_id", billRow.id).maybeSingle(),
      ]);
      if (!settings || settings.vat_registered) {
        throw new Error(
          settings?.vat_registered
            ? "VAT registration status changed. Tax invoice workflow must be configured before issuing this document."
            : "Seller receipt settings are missing.",
        );
      }
      let table = "—";
      if (order?.table_id) {
        const { data: tableRow } = await supabase
          .from("restaurant_tables")
          .select("code")
          .eq("id", order.table_id)
          .maybeSingle();
        if (tableRow?.code) table = tableRow.code;
      }
      const record = document as ReceiptRecord | null;
      setData({
        bill: billRow as unknown as Bill,
        items: (items ?? []) as ReceiptItem[],
        payments: (payments ?? []) as Payment[],
        table,
        seller: settings as Seller,
        record,
      });
      setBuyer(
        record
          ? {
              customer_type: record.customer_type,
              customer_name: record.customer_name,
              customer_address: record.customer_address,
              customer_tax_id: record.customer_tax_id ?? "",
              customer_branch_label: record.customer_branch_label ?? "Head Office / สำนักงานใหญ่",
              customer_branch_number: record.customer_branch_number ?? "00000",
              customer_email: record.customer_email ?? "",
              customer_phone: record.customer_phone ?? "",
            }
          : emptyBuyer,
      );
    } catch (error) {
      toast.error(localizeError(error, lang, "receipt"));
    } finally {
      setLoading(false);
    }
  };

  const validate = () => {
    if (!data) return false;
    if (!buyer.customer_name.trim() || !buyer.customer_address.trim()) {
      toast.error(copy("กรุณากรอกชื่อลูกค้าและที่อยู่", "Customer name and address are required"));
      return false;
    }
    if (buyer.customer_type === "company" && !buyer.customer_tax_id.trim()) {
      toast.error(copy("กรุณากรอกเลขประจำตัวผู้เสียภาษีของบริษัท", "Company Tax ID is required"));
      return false;
    }
    return true;
  };

  const save = async () => {
    if (!validate() || !data) return false;
    setSaving(true);
    try {
      const payload = {
        bill_id: data.bill.id,
        receipt_number: data.bill.receipt_number,
        document_kind: "receipt",
        ...buyer,
        customer_tax_id: buyer.customer_tax_id.trim() || null,
        customer_branch_label:
          buyer.customer_type === "company" ? buyer.customer_branch_label.trim() || null : null,
        customer_branch_number:
          buyer.customer_type === "company" ? buyer.customer_branch_number.trim() || null : null,
        customer_email: buyer.customer_email.trim() || null,
        customer_phone: buyer.customer_phone.trim() || null,
        seller_legal_name_th: data.seller.legal_name_th,
        seller_legal_name_en: data.seller.legal_name_en,
        seller_address: data.seller.address,
        seller_tax_id: data.seller.business_tax_id,
        seller_branch_label: data.seller.business_branch_label,
        seller_branch_number: data.seller.business_branch_number,
        seller_vat_registered: false,
        issued_by: staff?.id ?? null,
        updated_at: new Date().toISOString(),
      };
      const { data: saved, error } = await supabase
        .from("receipt_documents")
        .upsert(payload, { onConflict: "bill_id" })
        .select("id")
        .single();
      if (error) throw error;
      setData({ ...data, record: { id: saved.id, ...buyer } });
      toast.success(copy("บันทึกใบเสร็จแล้ว", "Receipt saved"));
      return true;
    } catch (error) {
      toast.error(localizeError(error, lang, "receipt"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const printOrSavePdf = async () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error(copy("กรุณาอนุญาตหน้าต่างป๊อปอัป", "Allow pop-ups to print or save PDF"));
      return;
    }
    printWindow.document.write(
      `<p style="font-family:sans-serif;padding:20px">${copy("กำลังเตรียมใบเสร็จ…", "Preparing receipt…")}</p>`,
    );
    if (!(await save()) || !data) {
      printWindow.close();
      return;
    }
    writePrintWindow(printWindow, receiptHtml(data, buyer));
  };

  const printAtCounter = async () => {
    if (!(await save()) || !data) return;
    try {
      await printCounter(
        {
          kind: "receipt",
          bill_id: data.bill.id,
          invoice_no: data.bill.receipt_number,
          restaurant: data.seller.legal_name_th,
          document_title: "ใบเสร็จรับเงิน / RECEIPT",
          seller_legal_name_en: data.seller.legal_name_en,
          address: data.seller.address,
          seller_tax_id: data.seller.business_tax_id,
          seller_branch: `${data.seller.business_branch_label} — ${data.seller.business_branch_number}`,
          non_vat_notice: "ไม่ใช่ใบกำกับภาษี / NOT A TAX INVOICE",
          customer_name: buyer.customer_name,
          customer_address: buyer.customer_address,
          customer_tax_id: buyer.customer_tax_id || undefined,
          customer_branch:
            buyer.customer_type === "company"
              ? `${buyer.customer_branch_label} ${buyer.customer_branch_number}`
              : undefined,
          table: data.table,
          items: data.items,
          discountAmount: Number(data.bill.discount_amount),
          memberDiscountAmount: Number(data.bill.member_discount_amount),
          pointsDiscountAmount: Number(data.bill.loyalty_discount_amount),
          serviceFeeAmount: Number(data.bill.service_fee_amount),
          vatAmount: 0,
          roundingAdjustment: Number(data.bill.rounding_adjustment),
          total: Number(data.bill.total),
          payments: data.payments,
        },
        {
          jobKey: `formal-receipt:${data.bill.id}:${crypto.randomUUID()}`,
          sourceType: "formal_receipt",
          sourceId: data.bill.id,
        },
      );
      toast.success(copy("ส่งใบเสร็จไปยังเครื่องพิมพ์แล้ว", "Receipt sent to the counter printer"));
    } catch (error) {
      toast.error(localizeError(error, lang, "print"));
    }
  };

  const set = <K extends keyof BuyerForm>(key: K, value: BuyerForm[K]) =>
    setBuyer((current) => ({ ...current, [key]: value }));

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-3xl font-bold">{copy("ใบเสร็จรับเงิน", "Customer Receipts")}</h1>
        <p className="mt-1 text-muted-foreground">
          {copy(
            "ค้นหาด้วยเลขที่ใบเสร็จ LM แล้วกรอกเฉพาะข้อมูลลูกค้า",
            "Search by the LM receipt number, then enter only the customer information.",
          )}
        </p>
      </div>

      <Card className="border-amber-500/60 bg-amber-50 dark:bg-amber-950/20">
        <CardContent className="py-4 text-sm font-medium">
          {copy(
            "ร้านยังไม่ได้จดทะเบียน VAT เอกสารนี้จึงเป็นใบเสร็จรับเงิน ไม่ใช่ใบกำกับภาษี",
            "The business is not VAT registered. This document is a receipt, not a tax invoice.",
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{copy("ค้นหาใบเสร็จ", "Find receipt")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="LM20261007001"
            onKeyDown={(event) => {
              if (event.key === "Enter") void search();
            }}
          />
          <Button onClick={() => void search()} disabled={loading} className="sm:w-40">
            <Search className="mr-2 h-4 w-4" />
            {loading ? copy("กำลังค้นหา…", "Searching…") : copy("ค้นหา", "Search")}
          </Button>
        </CardContent>
      </Card>

      {data && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{data.bill.receipt_number}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>{copy("วันที่", "Date")}</span>
                  <span>
                    {new Date(data.bill.paid_at).toLocaleString(undefined, {
                      timeZone: "Asia/Bangkok",
                    })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{copy("โต๊ะ", "Table")}</span>
                  <span>{data.table}</span>
                </div>
                {data.items.map((item) => (
                  <div key={item.id} className="flex justify-between border-t pt-2">
                    <span>
                      {item.qty}× {lang === "th" ? item.name_th : item.name_en}
                    </span>
                    <span>{thb(item.qty * Number(item.unit_price))}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t pt-3 text-lg font-bold">
                  <span>{copy("ยอดสุทธิ", "Total")}</span>
                  <span>{thb(data.bill.total)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  {copy("ข้อมูลผู้ออกใบเสร็จ (ล็อกไว้)", "Seller details (locked)")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="font-semibold">{data.seller.legal_name_th}</p>
                <p>{data.seller.legal_name_en}</p>
                <p>{data.seller.address}</p>
                <p>Tax ID: {data.seller.business_tax_id}</p>
                <p>
                  {data.seller.business_branch_label} — {data.seller.business_branch_number}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{copy("ข้อมูลลูกค้า", "Customer information")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{copy("ประเภทลูกค้า", "Customer type")}</Label>
                <Select
                  value={buyer.customer_type}
                  onValueChange={(value) => set("customer_type", value as CustomerType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individual">{copy("บุคคล", "Individual")}</SelectItem>
                    <SelectItem value="company">{copy("บริษัท", "Company")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{copy("ชื่อบุคคล / ชื่อบริษัท *", "Customer / company name *")}</Label>
                <Input
                  value={buyer.customer_name}
                  onChange={(e) => set("customer_name", e.target.value)}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>{copy("ที่อยู่ *", "Address *")}</Label>
                <Textarea
                  value={buyer.customer_address}
                  onChange={(e) => set("customer_address", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>
                  {copy(
                    `เลขประจำตัวผู้เสียภาษี${buyer.customer_type === "company" ? " *" : ""}`,
                    `Customer Tax ID${buyer.customer_type === "company" ? " *" : ""}`,
                  )}
                </Label>
                <Input
                  value={buyer.customer_tax_id}
                  onChange={(e) => set("customer_tax_id", e.target.value)}
                />
              </div>
              {buyer.customer_type === "company" && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label>{copy("สำนักงานใหญ่ / สาขา", "Head office / Branch")}</Label>
                    <Input
                      value={buyer.customer_branch_label}
                      onChange={(e) => set("customer_branch_label", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{copy("เลขที่สาขา", "Branch no.")}</Label>
                    <Input
                      value={buyer.customer_branch_number}
                      onChange={(e) => set("customer_branch_number", e.target.value)}
                    />
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={buyer.customer_email}
                  onChange={(e) => set("customer_email", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{copy("โทรศัพท์", "Phone")}</Label>
                <Input
                  value={buyer.customer_phone}
                  onChange={(e) => set("customer_phone", e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => void save()} disabled={saving}>
              {copy("บันทึก", "Save")}
            </Button>
            <Button variant="outline" onClick={() => void printAtCounter()} disabled={saving}>
              <Printer className="mr-2 h-4 w-4" />
              {copy("พิมพ์ที่เคาน์เตอร์", "Print at counter")}
            </Button>
            <Button onClick={() => void printOrSavePdf()} disabled={saving}>
              <Download className="mr-2 h-4 w-4" />
              {copy("พิมพ์ / บันทึก PDF", "Print / Save PDF")}
            </Button>
          </div>
        </>
      )}
    </main>
  );
}
