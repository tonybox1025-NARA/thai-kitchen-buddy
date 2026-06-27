import type { ReceiptData } from "@/lib/print/types";

const fmt = (n: number) => n.toFixed(2);

export function ReceiptPreview72({ data }: { data: ReceiptData }) {
  return (
    <div className="receipt-72 mx-auto bg-white text-black font-mono text-[12px] leading-tight p-2" style={{ width: "72mm" }}>
      <div className="text-center font-bold text-[14px]">{data.restaurant}</div>
      {data.address && <div className="text-center text-[11px]">{data.address}</div>}
      {data.taxId && <div className="text-center text-[11px]">Tax ID: {data.taxId}</div>}
      <div className="border-t border-dashed border-black my-1" />
      <div className="flex justify-between"><span>Bill:</span><span>{data.billNo}</span></div>
      {data.table && <div className="flex justify-between"><span>Table:</span><span>{data.table}</span></div>}
      {data.cashier && <div className="flex justify-between"><span>Cashier:</span><span>{data.cashier}</span></div>}
      <div className="flex justify-between"><span>Date:</span><span>{new Date(data.printedAt).toLocaleString()}</span></div>
      <div className="border-t border-dashed border-black my-1" />
      {data.items.map((it, i) => (
        <div key={i} className="mb-0.5">
          <div className="flex justify-between">
            <span className="truncate pr-1">{it.name}</span>
            <span>{fmt(it.qty * it.unitPrice)}</span>
          </div>
          <div className="text-[10px] text-black">  {it.qty} x {fmt(it.unitPrice)}</div>
        </div>
      ))}
      <div className="border-t border-dashed border-black my-1" />
      <div className="flex justify-between"><span>Subtotal</span><span>{fmt(data.subtotal)}</span></div>
      {data.discount ? <div className="flex justify-between"><span>Discount</span><span>-{fmt(data.discount)}</span></div> : null}
      {data.serviceCharge ? <div className="flex justify-between"><span>Service</span><span>{fmt(data.serviceCharge)}</span></div> : null}
      <div className="flex justify-between">
        <span>VAT {data.vatRate}% ({data.vatMode})</span><span>{fmt(data.vatAmount)}</span>
      </div>
      {data.roundingAdjustment ? <div className="flex justify-between"><span>Rounding</span><span>{data.roundingAdjustment > 0 ? "+" : ""}{fmt(data.roundingAdjustment)}</span></div> : null}
      <div className="flex justify-between font-bold text-[14px] mt-1">
        <span>TOTAL</span><span>{fmt(data.total)}</span>
      </div>
      <div className="border-t border-dashed border-black my-1" />
      {data.payments.map((p, i) => (
        <div key={i} className="flex justify-between"><span>{p.method.toUpperCase()}</span><span>{fmt(p.amount)}</span></div>
      ))}
      {data.change != null && data.change > 0 && (
        <div className="flex justify-between"><span>Change</span><span>{fmt(data.change)}</span></div>
      )}
      <div className="border-t border-dashed border-black my-1" />
      <div className="text-center text-[11px]">Thank you / ขอบคุณค่ะ</div>
    </div>
  );
}

/** Render to HTML string for window.print() injection. */
export function receiptToHtml(data: ReceiptData): string {
  const rows = data.items.map((it) =>
    `<div class="row"><span class="name">${escapeHtml(it.name)}</span><span>${fmt(it.qty * it.unitPrice)}</span></div>
     <div class="sub">  ${it.qty} x ${fmt(it.unitPrice)}</div>`
  ).join("");
  const pays = data.payments.map((p) =>
    `<div class="row"><span>${escapeHtml(p.method.toUpperCase())}</span><span>${fmt(p.amount)}</span></div>`
  ).join("");
  return `
  <style>
    @page { size: 72mm auto; margin: 0; }
    .r { width: 72mm; padding: 4mm 3mm; font-family: ui-monospace, monospace; font-size: 12px; color: #000; }
    .center { text-align: center; }
    .b { font-weight: 700; }
    .lg { font-size: 14px; }
    .row { display: flex; justify-content: space-between; }
    .sub { font-size: 10px; }
    .hr { border-top: 1px dashed #000; margin: 4px 0; }
    .name { padding-right: 4px; }
  </style>
  <div class="r">
    <div class="center b lg">${escapeHtml(data.restaurant)}</div>
    ${data.address ? `<div class="center">${escapeHtml(data.address)}</div>` : ""}
    ${data.taxId ? `<div class="center">Tax ID: ${escapeHtml(data.taxId)}</div>` : ""}
    <div class="hr"></div>
    <div class="row"><span>Bill:</span><span>${escapeHtml(data.billNo)}</span></div>
    ${data.table ? `<div class="row"><span>Table:</span><span>${escapeHtml(data.table)}</span></div>` : ""}
    ${data.cashier ? `<div class="row"><span>Cashier:</span><span>${escapeHtml(data.cashier)}</span></div>` : ""}
    <div class="row"><span>Date:</span><span>${escapeHtml(new Date(data.printedAt).toLocaleString())}</span></div>
    <div class="hr"></div>
    ${rows}
    <div class="hr"></div>
    <div class="row"><span>Subtotal</span><span>${fmt(data.subtotal)}</span></div>
    ${data.discount ? `<div class="row"><span>Discount</span><span>-${fmt(data.discount)}</span></div>` : ""}
    ${data.serviceCharge ? `<div class="row"><span>Service</span><span>${fmt(data.serviceCharge)}</span></div>` : ""}
    <div class="row"><span>VAT ${data.vatRate}% (${data.vatMode})</span><span>${fmt(data.vatAmount)}</span></div>
    ${data.roundingAdjustment ? `<div class="row"><span>Rounding</span><span>${data.roundingAdjustment > 0 ? "+" : ""}${fmt(data.roundingAdjustment)}</span></div>` : ""}
    <div class="row b lg"><span>TOTAL</span><span>${fmt(data.total)}</span></div>
    <div class="hr"></div>
    ${pays}
    ${data.change != null && data.change > 0 ? `<div class="row"><span>Change</span><span>${fmt(data.change)}</span></div>` : ""}
    <div class="hr"></div>
    <div class="center">Thank you / ขอบคุณค่ะ</div>
  </div>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
