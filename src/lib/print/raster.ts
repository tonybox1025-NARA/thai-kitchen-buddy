/**
 * Image-based ESC/POS composer — renders the whole receipt / kitchen ticket onto
 * an offscreen canvas, then thresholds it to 1-bit and emits it as an ESC/POS
 * raster image (GS v 0). This is what lets THAI and BURMESE menu names, the logo,
 * and large fonts print exactly as laid out — the 80mm thermal printers have no
 * Thai/Myanmar code page, so a text-only ESC/POS stream would drop those scripts.
 *
 * This is the TypeScript port of the proven Android renderer (lonmoh-print-bridge
 * Renderer.kt, sizes tuned to MERI×1.20). The byte stream it produces is handed to
 * the native PosPrinter plugin as a dumb transport (TCP / USB / SUNMI), so a
 * receipt printed straight from the APK matches one the print bridge renders.
 *
 * Runs in the WebView (the APK) where <canvas>, fetch, and the bundled Thai/Burmese
 * fonts are all available.
 */

const WIDTH = 576; // 80mm printable @ 203dpi = 576 dots
const PAD_X = 18;
const CONTENT_W = WIDTH - PAD_X * 2;

const INIT = [0x1b, 0x40];
const CUT = [0x1d, 0x56, 0x42, 0x05]; // partial cut + feed
const BEEP = [0x1b, 0x42, 0x03, 0x05]; // buzzer on QR orders
const ALIGN_CENTER = [0x1b, 0x61, 0x01];

// Font stack: Latin first (Inter), then Thai, then Myanmar — the browser falls back
// per-glyph so a single mixed-script line renders correctly, like Android's Paint.
const FAMILY = `"Inter", "Noto Sans Thai", "Padauk", sans-serif`;
function fontStr(size: number, bold: boolean): string {
  return `${bold ? "bold " : ""}${size}px ${FAMILY}`;
}

// sizes = MERI baseline × 1.20 (owner picked 120% in the size tuner)
const SIZE = {
  norm: 34,
  bold: 34,
  small: 28,
  big: 48, // restaurant name / kitchen table no.
  xl: 58, // net total
  item: 41, // kitchen menu item (Thai)
  myBold: 40, // Burmese line under it
} as const;

type Style = { size: number; bold: boolean };
const S = {
  norm: { size: SIZE.norm, bold: false } as Style,
  bold: { size: SIZE.bold, bold: true } as Style,
  small: { size: SIZE.small, bold: false } as Style,
  big: { size: SIZE.big, bold: true } as Style,
  xl: { size: SIZE.xl, bold: true } as Style,
  item: { size: SIZE.item, bold: true } as Style,
  myBold: { size: SIZE.myBold, bold: true } as Style,
};

type Align = "left" | "center" | "right";

// ── Payload shapes (mirror print_jobs.payload written by the POS) ─────────────

export type ReceiptItem = { name_en?: string; name_th?: string; qty: number; unit_price: number };
export type ReceiptPayload = {
  kind: "receipt";
  restaurant?: string;
  logoUrl?: string;
  promo?: string;
  address?: string;
  invoice_no?: string;
  table?: string;
  items?: ReceiptItem[];
  discountAmount?: number;
  memberDiscountAmount?: number;
  pointsDiscountAmount?: number;
  serviceFeeAmount?: number;
  vatAmount?: number;
  roundingAdjustment?: number;
  total: number;
  payments?: {
    method: "cash" | "qr" | "gov_qr" | string;
    amount: number;
    cash_received?: number;
    change_due?: number;
  }[];
  loyaltyClaimUrl?: string;
};

export type KitchenLine = {
  qty: number;
  name_en?: string;
  name_th?: string;
  name_my?: string;
  notes?: string | null;
  zoneLabel?: string | null;
  modifiers?: { option_name?: string; qty?: number; price?: number }[];
};
export type KitchenPayload = {
  kind: "order_ticket";
  table?: string;
  sent_at?: string;
  order_no?: string;
  waiter?: string;
  order_type?: "added" | "new" | string;
  source?: "qr" | "pos" | string;
  department?: string;
  station?: string;
  lines?: KitchenLine[];
};

export type TableQrPayload = {
  kind: "table_qr";
  table?: string;
  url: string;
  restaurant?: string;
  guests?: number;
};

export type PrintPayload = ReceiptPayload | KitchenPayload | TableQrPayload;

// ── formatting ────────────────────────────────────────────────────────────────

function money(n: number): string {
  return (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function two(n: number): string {
  return String(n).padStart(2, "0");
}
function fmtDate(d: Date): string {
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function fmtTime(d: Date): string {
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

// ── font readiness ────────────────────────────────────────────────────────────
// Canvas draws with whatever is loaded at call time and never triggers a font
// load itself, so make sure the faces we measure/draw with are ready first.
let fontsReady: Promise<void> | null = null;
function ensureFonts(): Promise<void> {
  if (fontsReady) return fontsReady;
  const fonts = (document as any).fonts;
  if (!fonts?.load) return (fontsReady = Promise.resolve());
  fontsReady = Promise.all([
    fonts.load(`${SIZE.norm}px "Noto Sans Thai"`, "ก"),
    fonts.load(`bold ${SIZE.norm}px "Noto Sans Thai"`, "ก"),
    fonts.load(`bold ${SIZE.big}px "Noto Sans Thai"`, "ก"),
    fonts.load(`bold ${SIZE.myBold}px "Padauk"`, "မ"),
    fonts.load(`${SIZE.norm}px "Inter"`),
    fonts.load(`bold ${SIZE.xl}px "Inter"`),
  ])
    .then(() => undefined)
    .catch(() => undefined);
  return fontsReady;
}

// ── layout engine ─────────────────────────────────────────────────────────────

type Op = (ctx: CanvasRenderingContext2D) => void;

class Doc {
  private ops: Op[] = [];
  private m: CanvasRenderingContext2D;
  y: number;

  constructor(topPad = 16) {
    this.y = topPad;
    const c = document.createElement("canvas");
    this.m = c.getContext("2d")!;
  }

  private setFont(s: Style) {
    this.m.font = fontStr(s.size, s.bold);
  }

  private metrics(s: Style): { asc: number; desc: number; lh: number } {
    this.setFont(s);
    const tm = this.m.measureText("Xกႜ");
    const asc = tm.fontBoundingBoxAscent ?? tm.actualBoundingBoxAscent ?? s.size * 0.8;
    const desc = tm.fontBoundingBoxDescent ?? tm.actualBoundingBoxDescent ?? s.size * 0.25;
    return { asc, desc, lh: asc + desc + 5 };
  }

  private measure(text: string, s: Style): number {
    this.setFont(s);
    return this.m.measureText(text).width;
  }

  private wrap(text: string, s: Style, maxW: number): string[] {
    const out: string[] = [];
    for (const para of String(text).split("\n")) {
      if (para === "") {
        out.push("");
        continue;
      }
      let cur = "";
      for (const w of para.split(" ")) {
        const cand = cur === "" ? w : `${cur} ${w}`;
        if (this.measure(cand, s) <= maxW) {
          cur = cand;
        } else {
          if (cur !== "") {
            out.push(cur);
            cur = "";
          }
          if (this.measure(w, s) <= maxW) {
            cur = w;
          } else {
            let chunk = "";
            for (const ch of w) {
              if (this.measure(chunk + ch, s) <= maxW) chunk += ch;
              else {
                if (chunk !== "") out.push(chunk);
                chunk = ch;
              }
            }
            cur = chunk;
          }
        }
      }
      out.push(cur);
    }
    return out;
  }

  feed(px: number) {
    this.y += px;
  }

  text(str: string, s: Style, align: Align = "left") {
    const { asc, lh } = this.metrics(s);
    const x = align === "left" ? PAD_X : align === "center" ? WIDTH / 2 : WIDTH - PAD_X;
    for (const ln of this.wrap(str, s, CONTENT_W)) {
      const baseline = this.y + asc;
      this.ops.push((ctx) => {
        ctx.font = fontStr(s.size, s.bold);
        ctx.textAlign = align;
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "#000";
        ctx.fillText(ln, x, baseline);
      });
      this.y += lh;
    }
  }

  row(left: string, right: string, s: Style) {
    const { asc, lh } = this.metrics(s);
    const rightW = this.measure(right, s);
    const maxLeftW = Math.max(40, CONTENT_W - rightW - 14);
    const lines = this.wrap(left, s, maxLeftW);
    lines.forEach((ln, i) => {
      const baseline = this.y + asc;
      this.ops.push((ctx) => {
        ctx.font = fontStr(s.size, s.bold);
        ctx.fillStyle = "#000";
        ctx.textBaseline = "alphabetic";
        ctx.textAlign = "left";
        ctx.fillText(ln, PAD_X, baseline);
        if (i === 0) {
          ctx.textAlign = "right";
          ctx.fillText(right, WIDTH - PAD_X, baseline);
        }
      });
      this.y += lh;
    });
  }

  rule(solid = false) {
    this.y += 6;
    const yy = this.y;
    this.ops.push((ctx) => {
      ctx.strokeStyle = "#000";
      ctx.lineWidth = solid ? 3 : 1.5;
      if (solid) {
        ctx.beginPath();
        ctx.moveTo(PAD_X, yy);
        ctx.lineTo(WIDTH - PAD_X, yy);
        ctx.stroke();
      } else {
        let x = PAD_X;
        ctx.beginPath();
        while (x < WIDTH - PAD_X) {
          ctx.moveTo(x, yy);
          ctx.lineTo(x + 6, yy);
          x += 12;
        }
        ctx.stroke();
      }
    });
    this.y += 12;
  }

  logo(bmp: CanvasImageSource, w: number, h: number) {
    const targetW = 280;
    const scale = targetW / w;
    const hh = h * scale;
    const left = (WIDTH - targetW) / 2;
    const top = this.y;
    this.ops.push((ctx) => {
      ctx.drawImage(bmp, left, top, targetW, hh);
    });
    this.y += hh + 10;
  }

  /** Render everything to a 1-bit ESC/POS raster (GS v 0), sent in horizontal bands. */
  toRaster(): number[] {
    const h = Math.max(40, Math.ceil(this.y + 20));
    const c = document.createElement("canvas");
    c.width = WIDTH;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, WIDTH, h);
    for (const op of this.ops) op(ctx);
    const px = ctx.getImageData(0, 0, WIDTH, h).data;

    const bytesPerRow = (WIDTH + 7) >> 3;
    const out: number[] = [];
    const band = 128;
    for (let y0 = 0; y0 < h; y0 += band) {
      const rows = Math.min(band, h - y0);
      out.push(0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, rows & 0xff, (rows >> 8) & 0xff);
      for (let row = 0; row < rows; row++) {
        for (let bx = 0; bx < bytesPerRow; bx++) {
          let b = 0;
          for (let bit = 0; bit < 8; bit++) {
            const x = bx * 8 + bit;
            if (x < WIDTH) {
              const idx = ((y0 + row) * WIDTH + x) * 4;
              const a = px[idx + 3];
              const lum = (px[idx] * 299 + px[idx + 1] * 587 + px[idx + 2] * 114) / 1000;
              if (a > 128 && lum < 128) b |= 0x80 >> bit;
            }
          }
          out.push(b);
        }
      }
    }
    return out;
  }
}

// ── native 2D QR (loyalty claim on the receipt) ───────────────────────────────

function qrBytes(text: string): number[] {
  const data = Array.from(new TextEncoder().encode(text));
  const len = data.length + 3;
  const pL = len & 0xff;
  const pH = (len >> 8) & 0xff;
  return [
    0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00, // model 2
    0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x07, // module size 7
    0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31, // error correction M
    0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30, ...data, // store data
    0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30, // print
  ];
}

async function loadBitmap(url: string): Promise<{ bmp: CanvasImageSource; w: number; h: number } | null> {
  try {
    // Fetch to a blob first: a blob-URL image is same-origin and won't taint the
    // canvas (a cross-origin <img> would make getImageData throw). Fails closed
    // (no logo) when offline or CORS-blocked.
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    if (typeof createImageBitmap === "function") {
      const bmp = await createImageBitmap(blob);
      return { bmp, w: bmp.width, h: bmp.height };
    }
    const objUrl = URL.createObjectURL(blob);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = objUrl;
    });
    URL.revokeObjectURL(objUrl);
    return { bmp: img, w: img.naturalWidth, h: img.naturalHeight };
  } catch {
    return null;
  }
}

// ── RECEIPT (counter / customer) ──────────────────────────────────────────────

export async function buildReceipt(p: ReceiptPayload): Promise<Uint8Array> {
  await ensureFonts();
  const d = new Doc(40);
  const now = new Date();

  if (p.logoUrl) {
    const logo = await loadBitmap(p.logoUrl);
    if (logo) d.logo(logo.bmp, logo.w, logo.h);
  }

  d.text(p.restaurant || "Restaurant", S.big, "center");
  if (p.promo) d.text(p.promo, S.small, "center");
  if (p.address) d.text(p.address, S.small, "center");
  d.rule();

  d.text(`วันที่ ${fmtDate(now)}  เวลา ${fmtTime(now)}`, S.norm);
  if (p.invoice_no) d.text(`บิล ${p.invoice_no}`, S.norm);
  d.text(`โต๊ะ ${p.table ?? "-"}`, S.norm);
  d.rule();

  d.text("รายการ", S.bold);
  d.feed(4);

  const items = p.items ?? [];
  let subtotal = 0;
  for (const it of items) {
    const name = it.name_th || it.name_en || "Item";
    const qty = Number(it.qty) || 0;
    const lineTotal = (Number(it.unit_price) || 0) * qty;
    subtotal += lineTotal;
    d.row(`${qty}x  ${name}`, money(lineTotal), S.norm);
  }
  d.rule();

  const shownSub = items.length > 0 ? subtotal : p.total;
  d.row("ยอดรวมก่อนส่วนลด", money(shownSub), S.norm);
  if ((p.discountAmount ?? 0) > 0) d.row("ส่วนลด", "-" + money(p.discountAmount!), S.norm);
  if ((p.memberDiscountAmount ?? 0) > 0) d.row("ส่วนลดสมาชิก", "-" + money(p.memberDiscountAmount!), S.norm);
  if ((p.pointsDiscountAmount ?? 0) > 0) d.row("ใช้แต้ม", "-" + money(p.pointsDiscountAmount!), S.norm);
  if ((p.serviceFeeAmount ?? 0) > 0) d.row("ค่าบริการ", money(p.serviceFeeAmount!), S.norm);
  if ((p.vatAmount ?? 0) > 0) d.row("VAT", money(p.vatAmount!), S.norm);
  if ((p.roundingAdjustment ?? 0) !== 0) d.row("ปัดเศษ", money(p.roundingAdjustment!), S.norm);

  d.rule(true);
  d.row("ยอดสุทธิ", money(p.total), S.xl);
  d.rule(true);

  for (const pay of p.payments ?? []) {
    const label =
      pay.method === "cash" ? "เงินสด" : pay.method === "qr" ? "QR" : pay.method === "gov_qr" ? "60/40" : "บัตรเครดิต";
    d.row(label, money(pay.amount), S.norm);
    if ((pay.cash_received ?? 0) > 0) d.row("  รับมา", money(pay.cash_received!), S.small);
    if ((pay.change_due ?? 0) > 0) d.row("  ทอน", money(pay.change_due!), S.small);
  }
  d.rule();
  d.text("ขอบคุณค่ะ · Thank you", S.bold, "center");

  const out: number[] = [...INIT, ...d.toRaster()];
  if (p.loyaltyClaimUrl) {
    out.push(0x0a, ...ALIGN_CENTER, ...qrBytes(p.loyaltyClaimUrl), 0x0a);
  }
  out.push(...CUT);
  return Uint8Array.from(out);
}

// ── KITCHEN TICKET (Thai + Burmese) ───────────────────────────────────────────
// Tall top margin: staff clip tickets onto a hold-bar by the top edge, so the
// time (top-right) must stay visible below the clip.

export async function buildKitchen(p: KitchenPayload): Promise<Uint8Array> {
  await ensureFonts();
  const d = new Doc(120);
  const sentAt = p.sent_at ? new Date(p.sent_at) : new Date();
  const isQr = p.source === "qr";
  const lines = p.lines ?? [];

  d.text(fmtTime(sentAt), S.small, "right");
  if (p.order_no) d.text(`#${p.order_no}`, S.bold);

  const zone = p.department || p.station || lines.find((l) => l.zoneLabel)?.zoneLabel;
  if (zone) d.text(`โซน : ${zone}`, S.norm);

  d.text(`โต๊ะ ${p.table ?? "?"}`, S.big);
  if (p.waiter) d.text(`โดย ${p.waiter}`, S.norm);
  d.text(p.order_type === "added" ? "เพิ่มออเดอร์ (ADDED)" : "ออเดอร์ใหม่ (NEW)", S.small);
  if (isQr) d.text("[ QR ORDER ]", S.bold);
  d.text(`รายการ (${lines.length})`, S.norm);
  d.rule(true);

  for (const it of lines) {
    const th = it.name_th || it.name_en || "Item";
    const my = it.name_my;
    const qty = Number(it.qty) || 0;
    d.text(`${qty}x  ${th}`, S.item);
    if (my && my !== th) d.text(my, S.myBold);
    if (it.notes) d.text(`   ** ${it.notes} **`, S.norm);
    for (const mod of it.modifiers ?? []) {
      const q = mod.qty ?? 1;
      const qs = q > 1 ? ` x${q}` : "";
      const price = mod.price ?? 0;
      const ps = price > 0 ? ` +${Math.round(price * q)}` : "";
      const on = mod.option_name ?? "Option";
      d.text(`   + ${on}${qs}${ps}`, S.norm);
    }
    d.feed(4);
  }
  d.rule(true);
  d.text("KITCHEN  မီးဖိုချောင်", S.bold, "center");

  const out: number[] = [...INIT];
  if (isQr) out.push(...BEEP);
  out.push(...d.toRaster(), ...CUT);
  return Uint8Array.from(out);
}

// ── TABLE QR SLIP (guest scans to self-order) ─────────────────────────────────
// Rastered Thai header + a native 2D QR (crisp, scannable) for the menu URL.

export async function buildTableQr(p: TableQrPayload): Promise<Uint8Array> {
  await ensureFonts();
  const d = new Doc(24);
  d.text(p.restaurant || "Restaurant", S.big, "center");
  d.text(`โต๊ะ ${p.table ?? "-"}`, S.xl, "center");
  if (p.guests && p.guests > 0) d.text(`${p.guests} ท่าน`, S.norm, "center");
  d.rule();
  d.text("สแกนเพื่อสั่งอาหาร", S.bold, "center");
  d.text("Scan to order", S.small, "center");
  d.feed(8);

  const out: number[] = [...INIT, ...d.toRaster(), 0x0a, ...ALIGN_CENTER, ...qrBytes(p.url), 0x0a, 0x0a, ...CUT];
  return Uint8Array.from(out);
}

// ── on-screen / self test (Latin + Thai + Burmese) ────────────────────────────

export async function buildTest(label = "APP"): Promise<Uint8Array> {
  await ensureFonts();
  const d = new Doc(24);
  d.text("LONMOH TEST", S.big, "center");
  d.text(label, S.norm, "center");
  d.text(`${fmtDate(new Date())} ${fmtTime(new Date())}`, S.small, "center");
  d.rule();
  d.text("ไทย: ทดสอบพิมพ์ภาษาไทย", S.norm);
  d.text("မြန်မာ: စမ်းသပ်ပုံနှိပ်ခြင်း", S.myBold);
  d.text("English: print test OK", S.norm);
  d.rule();
  return Uint8Array.from([...INIT, ...d.toRaster(), ...CUT]);
}

// ── dispatch ──────────────────────────────────────────────────────────────────

export async function buildEscPos(payload: PrintPayload, printer?: "counter" | "kitchen"): Promise<Uint8Array> {
  if (payload.kind === "receipt") return buildReceipt(payload);
  if (payload.kind === "table_qr") return buildTableQr(payload);
  if (payload.kind === "order_ticket" || printer === "kitchen") return buildKitchen(payload as KitchenPayload);
  throw new Error(`Unknown print payload kind: ${(payload as { kind?: string }).kind}`);
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
