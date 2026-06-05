import type { KitchenTicketData } from "@/lib/print/types";

export function KitchenTicketPreview72({ data }: { data: KitchenTicketData }) {
  return (
    <div className="mx-auto bg-white text-black font-mono p-2" style={{ width: "72mm" }}>
      <div className="text-center font-bold text-[18px]">*** KITCHEN ***</div>
      {data.station && <div className="text-center text-[13px]">{data.station}</div>}
      <div className="border-t-2 border-black my-1" />
      <div className="flex justify-between text-[14px] font-bold">
        <span>Table: {data.table ?? "-"}</span>
        <span>{data.orderNo}</span>
      </div>
      <div className="text-[11px]">{new Date(data.printedAt).toLocaleString()}</div>
      <div className="border-t-2 border-black my-1" />
      {data.items.map((it, i) => (
        <div key={i} className="mb-2">
          <div className="text-[18px] font-bold leading-tight">{it.qty} × {it.name}</div>
          {it.note && <div className="text-[13px] italic pl-2">» {it.note}</div>}
        </div>
      ))}
      <div className="border-t-2 border-black my-1" />
      <div className="text-center text-[11px]">— end —</div>
    </div>
  );
}

export function kitchenToHtml(data: KitchenTicketData): string {
  const rows = data.items.map((it) =>
    `<div class="item"><div class="line">${it.qty} × ${escapeHtml(it.name)}</div>${
      it.note ? `<div class="note">» ${escapeHtml(it.note)}</div>` : ""
    }</div>`
  ).join("");
  return `
  <style>
    @page { size: 72mm auto; margin: 0; }
    .k { width: 72mm; padding: 4mm 3mm; font-family: ui-monospace, monospace; color: #000; }
    .center { text-align: center; }
    .title { font-size: 18px; font-weight: 700; }
    .station { font-size: 13px; }
    .row { display: flex; justify-content: space-between; font-size: 14px; font-weight: 700; }
    .date { font-size: 11px; }
    .hr { border-top: 2px solid #000; margin: 4px 0; }
    .item { margin-bottom: 8px; }
    .line { font-size: 18px; font-weight: 700; line-height: 1.1; }
    .note { font-size: 13px; font-style: italic; padding-left: 8px; }
  </style>
  <div class="k">
    <div class="center title">*** KITCHEN ***</div>
    ${data.station ? `<div class="center station">${escapeHtml(data.station)}</div>` : ""}
    <div class="hr"></div>
    <div class="row"><span>Table: ${escapeHtml(data.table ?? "-")}</span><span>${escapeHtml(data.orderNo)}</span></div>
    <div class="date">${escapeHtml(new Date(data.printedAt).toLocaleString())}</div>
    <div class="hr"></div>
    ${rows}
    <div class="hr"></div>
    <div class="center" style="font-size:11px">— end —</div>
  </div>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
