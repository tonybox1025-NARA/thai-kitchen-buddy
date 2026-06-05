import type { KitchenTicketData, KitchenItem } from "@/lib/print/types";

function displayName(it: KitchenItem): { primary: string; secondary?: string } {
  const primary = it.name_en ?? it.name;
  const secondary = it.name_my && it.name_my !== primary ? it.name_my : undefined;
  return { primary, secondary };
}

export function KitchenTicketPreview72({ data }: { data: KitchenTicketData }) {
  return (
    <div className="kitchen-72 mx-auto bg-white text-black font-mono p-2" style={{ width: "72mm" }}>
      <div className="text-center font-extrabold text-[22px] leading-tight">
        {data.department ?? "*** KITCHEN ***"}
      </div>
      {data.station && data.station !== data.department && (
        <div className="text-center text-[13px]">{data.station}</div>
      )}
      <div className="border-t-2 border-black my-1" />
      <div className="flex justify-between text-[14px] font-bold">
        <span>Table: {data.table ?? "-"}</span>
        <span>{data.orderNo}</span>
      </div>
      <div className="flex justify-between text-[11px]">
        <span>{new Date(data.printedAt).toLocaleString()}</span>
        {data.ticketIndex && data.ticketTotal && (
          <span className="font-bold">Ticket {data.ticketIndex}/{data.ticketTotal}</span>
        )}
      </div>
      <div className="border-t-2 border-black my-1" />
      {data.items.map((it, i) => {
        const { primary, secondary } = displayName(it);
        return (
          <div key={i} className="mb-2">
            <div className="text-[20px] font-extrabold leading-tight">
              {it.qty} × {primary}
            </div>
            {secondary && (
              <div className="text-[14px] leading-tight pl-2">{secondary}</div>
            )}
            {it.modifiers?.map((m, j) => (
              <div key={j} className="text-[13px] pl-3">• {m}</div>
            ))}
            {it.note && <div className="text-[13px] italic pl-2">» {it.note}</div>}
          </div>
        );
      })}
      <div className="border-t-2 border-black my-1" />
      <div className="text-center text-[11px]">— end —</div>
    </div>
  );
}

export function kitchenToHtml(data: KitchenTicketData): string {
  const rows = data.items.map((it) => {
    const { primary, secondary } = displayName(it);
    const mods = (it.modifiers ?? [])
      .map((m) => `<div class="mod">• ${escapeHtml(m)}</div>`)
      .join("");
    return `<div class="item">
      <div class="line">${it.qty} × ${escapeHtml(primary)}</div>
      ${secondary ? `<div class="sub">${escapeHtml(secondary)}</div>` : ""}
      ${mods}
      ${it.note ? `<div class="note">» ${escapeHtml(it.note)}</div>` : ""}
    </div>`;
  }).join("");
  const ticketTag = data.ticketIndex && data.ticketTotal
    ? `<span class="b">Ticket ${data.ticketIndex}/${data.ticketTotal}</span>`
    : "";
  return `
  <style>
    @page { size: 72mm auto; margin: 0; }
    .k { width: 72mm; padding: 4mm 3mm; font-family: ui-monospace, monospace; color: #000; }
    .center { text-align: center; }
    .title { font-size: 22px; font-weight: 800; line-height: 1.1; }
    .station { font-size: 13px; }
    .row { display: flex; justify-content: space-between; font-size: 14px; font-weight: 700; }
    .meta { display: flex; justify-content: space-between; font-size: 11px; }
    .b { font-weight: 700; }
    .hr { border-top: 2px solid #000; margin: 4px 0; }
    .item { margin-bottom: 8px; }
    .line { font-size: 20px; font-weight: 800; line-height: 1.1; }
    .sub { font-size: 14px; padding-left: 8px; line-height: 1.1; }
    .mod { font-size: 13px; padding-left: 12px; }
    .note { font-size: 13px; font-style: italic; padding-left: 8px; }
  </style>
  <div class="k">
    <div class="center title">${escapeHtml(data.department ?? "*** KITCHEN ***")}</div>
    ${data.station && data.station !== data.department ? `<div class="center station">${escapeHtml(data.station)}</div>` : ""}
    <div class="hr"></div>
    <div class="row"><span>Table: ${escapeHtml(data.table ?? "-")}</span><span>${escapeHtml(data.orderNo)}</span></div>
    <div class="meta"><span>${escapeHtml(new Date(data.printedAt).toLocaleString())}</span>${ticketTag}</div>
    <div class="hr"></div>
    ${rows}
    <div class="hr"></div>
    <div class="center" style="font-size:11px">— end —</div>
  </div>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
