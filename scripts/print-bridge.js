#!/usr/bin/env node
/**
 * ESC/POS Print Bridge  —  Q80A 80mm thermal printer
 *
 * Subscribes to Supabase Realtime on print_jobs table.
 * When a job arrives, connects via TCP (default port 9100) and sends ESC/POS.
 *
 * Works with anon key (SUPABASE_PUBLISHABLE_KEY) — no service role needed.
 * Requires these RLS policies on print_jobs (run once in Supabase SQL editor):
 *
 *   create policy "anon select print_jobs"
 *     on public.print_jobs for select to anon using (true);
 *   create policy "anon update print_jobs"
 *     on public.print_jobs for update to anon using (true) with check (true);
 *
 * Usage:
 *   node scripts/print-bridge.js
 *
 * Keep this running on any device on the same LAN as the printer (tablet, PC, RPi).
 */

import { createClient } from "@supabase/supabase-js";
import { createConnection } from "net";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
// Prefer service role if available; fall back to anon/publishable key
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const PRINTER_PORT = 9100;
const COLS         = 48;   // characters per line on 80mm at standard font

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌  Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY in .env");
  process.exit(1);
}

const usingAnonKey = !process.env.SUPABASE_SERVICE_ROLE_KEY;
if (usingAnonKey) {
  console.log("ℹ️   Using anon key — make sure anon RLS policies are applied on print_jobs.");
  console.log("    (See comment at top of this file for the required SQL.)");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// ── ESC/POS byte helpers ──────────────────────────────────────────────────────
const ESC = 0x1b;
const GS  = 0x1d;

const CMD = {
  INIT:         [ESC, 0x40],
  BOLD_ON:      [ESC, 0x45, 0x01],
  BOLD_OFF:     [ESC, 0x45, 0x00],
  ALIGN_LEFT:   [ESC, 0x61, 0x00],
  ALIGN_CENTER: [ESC, 0x61, 0x01],
  ALIGN_RIGHT:  [ESC, 0x61, 0x02],
  DSIZE_ON:     [GS,  0x21, 0x11],  // double height + width
  DSIZE_OFF:    [GS,  0x21, 0x00],
  UNDERLINE_ON: [ESC, 0x2d, 0x01],
  UNDERLINE_OFF:[ESC, 0x2d, 0x00],
  LF:           [0x0a],
  CUT:          [GS,  0x56, 0x42, 0x05],  // partial cut with 5-line feed
};

function buf(...parts) {
  const pieces = parts.map((p) => {
    if (typeof p === "string") return Buffer.from(p, "utf8");
    if (Array.isArray(p))     return Buffer.from(p);
    if (Buffer.isBuffer(p))   return p;
    return Buffer.from(String(p), "utf8");
  });
  return Buffer.concat(pieces);
}

function lf(n = 1) { return Buffer.alloc(n, 0x0a); }
function line(char = "-") { return char.repeat(COLS); }

// Pad/truncate string to fixed width (UTF-8 aware via spread)
function pad(str, len, align = "left") {
  const chars = [...(str ?? "")];
  if (chars.length >= len) return chars.slice(0, len).join("");
  const space = " ".repeat(len - chars.length);
  return align === "right" ? space + chars.join("") : chars.join("") + space;
}

// Format a two-column row: left text + right text flush to COLS
function twoCol(left, right) {
  const r = String(right);
  const l = pad(left, COLS - r.length);
  return l + r;
}

// Format Thai Baht — ASCII only (฿ is 3 UTF-8 bytes; printer renders it as
// garbage and the extra bytes break column-width calculations causing price
// overflow onto the next line).
function thb(n) { return `B${Number(n).toFixed(2)}`; }

// Format date/time — Gregorian calendar, DD/MM/YYYY HH:MM
function fmtDateTime(iso) {
  const d = new Date(iso);
  const dd   = String(d.getDate()).padStart(2, "0");
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();           // always Gregorian (e.g. 2026)
  const hh   = String(d.getHours()).padStart(2, "0");
  const min  = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function asciiText(value, fallback = "") {
  return [...String(value ?? "")]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x20 && code <= 0x7e;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim() || fallback;
}

// ── Receipt formatter (counter printer) ──────────────────────────────────────
function buildReceipt(p) {
  const now = fmtDateTime(new Date().toISOString());
  const parts = [
    CMD.INIT,
    CMD.ALIGN_CENTER,
    CMD.BOLD_ON, CMD.DSIZE_ON,
    p.restaurant || "Restaurant", lf(),
    CMD.DSIZE_OFF,
    lf(),
    `Table: ${p.table ?? "-"}   ${now}`, lf(),
    CMD.BOLD_OFF,
    CMD.ALIGN_LEFT,
    line(), lf(),
  ];

  // Items
  for (const item of p.items ?? []) {
    const name = item.name_en || item.name_th || "Item";
    const qty  = `x${item.qty}`;
    const price = thb(Number(item.unit_price) * Number(item.qty));
    // First line: name
    parts.push(pad(name, COLS - qty.length - price.length - 2) + " " + qty + " " + price, lf());
  }

  parts.push(line(), lf());

  // Totals
  const subtotal = p.items?.reduce((s, i) => s + Number(i.unit_price) * Number(i.qty), 0) ?? p.total;
  parts.push(twoCol("Subtotal", thb(subtotal)), lf());

  if (p.discountAmount > 0) {
    parts.push(twoCol("Discount", "-" + thb(p.discountAmount)), lf());
  }
  if (p.memberDiscountAmount > 0) {
    parts.push(twoCol("Member discount", "-" + thb(p.memberDiscountAmount)), lf());
  }
  if (p.vatAmount > 0) {
    const vatLabel = p.vat_mode === "exclusive"
      ? `VAT ${p.vatRate ?? 7}%`
      : `VAT incl. ${p.vatRate ?? 7}%`;
    parts.push(twoCol(vatLabel, thb(p.vatAmount)), lf());
  }

  parts.push(
    CMD.BOLD_ON,
    line("="), lf(),
    twoCol("TOTAL", thb(p.total)), lf(),
    line("="), lf(),
    CMD.BOLD_OFF,
  );

  // Payments
  for (const pay of p.payments ?? []) {
    const label = pay.method === "cash" ? "Cash"
                : pay.method === "qr"   ? "QR Transfer"
                : pay.method === "gov_qr" ? "Government QR"
                :                        "Credit Card";
    parts.push(twoCol(label, thb(pay.amount)), lf());
    if (pay.cash_received) parts.push(twoCol("  Received", thb(pay.cash_received)), lf());
    if (pay.change_due)    parts.push(twoCol("  Change",   thb(pay.change_due)),    lf());
  }

  parts.push(
    line(), lf(2),
    CMD.ALIGN_CENTER,
    CMD.BOLD_ON, "Thank you!", lf(),
    CMD.BOLD_OFF,
    lf(3),
    CMD.CUT,
  );

  return buf(...parts);
}

// ── Kitchen ticket formatter (kitchen printer) ────────────────────────────────
function buildKitchen(p) {
  const _kd  = new Date(p.sent_at ?? Date.now());
  const time = `${String(_kd.getHours()).padStart(2,"0")}:${String(_kd.getMinutes()).padStart(2,"0")}:${String(_kd.getSeconds()).padStart(2,"0")}`;
  const orderTypeLabel = p.order_type === "added" ? "ADDED ORDER" : "NEW ORDER";
  const parts = [
    CMD.INIT,
    CMD.ALIGN_CENTER,
    CMD.BOLD_ON, CMD.DSIZE_ON,
    `TABLE  ${p.table ?? "?"}`, lf(),
    orderTypeLabel, lf(),
    CMD.DSIZE_OFF,
    p.source === "qr" ? "[ QR ORDER ]" : "[ POS ]", lf(),
    time, lf(),
    CMD.BOLD_OFF,
    CMD.ALIGN_LEFT,
    line("="), lf(),
  ];

  for (const item of p.lines ?? []) {
    const name = asciiText(item.name_en) || asciiText(item.name_th) || asciiText(item.name_my) || "Item";
    parts.push(CMD.BOLD_ON, `${item.qty}  x  ${name}`, CMD.BOLD_OFF, lf());
    const notes = asciiText(item.notes);
    if (notes) parts.push(`     ** ${notes} **`, lf());
    // Print selected add-ons (stored in modifiers array)
    if (Array.isArray(item.modifiers) && item.modifiers.length > 0) {
      for (const mod of item.modifiers) {
        const q = mod.qty ?? 1;
        const qtyStr = q > 1 ? ` x${q}` : "";
        const priceStr = mod.price > 0 ? ` +${mod.price * q}` : "";
        const optionName = asciiText(mod.option_name, "Option");
        parts.push(`     + ${optionName}${qtyStr}${priceStr}`, lf());
      }
    }
  }

  parts.push(
    line("="), lf(3),
    CMD.CUT,
  );

  return buf(...parts);
}

// ── TCP send ──────────────────────────────────────────────────────────────────
function sendToPrinter(ip, data) {
  return new Promise((resolve, reject) => {
    if (!ip) return reject(new Error("Printer IP not configured"));
    const sock = createConnection({ host: ip, port: PRINTER_PORT });
    sock.setTimeout(5000);
    sock.once("connect", () => {
      sock.write(data, () => { sock.end(); resolve(); });
    });
    sock.once("error",   reject);
    sock.once("timeout", () => { sock.destroy(); reject(new Error(`Printer ${ip}:${PRINTER_PORT} timeout`)); });
  });
}

// ── Load printer IPs from settings ───────────────────────────────────────────
let printerIPs = {
  counter: process.env.PRINTER_COUNTER_IP ?? "192.168.1.220",
  kitchen: process.env.PRINTER_KITCHEN_IP ?? "192.168.1.100",
};

async function loadPrinterIPs() {
  const { data, error } = await supabase.from("settings").select("printer_counter_ip,printer_kitchen_ip").eq("id", 1).maybeSingle();
  if (error) {
    console.warn(`⚠️  Could not read settings (${error.message}) — using env/default IPs.`);
    console.warn("   If using anon key, run this SQL once in Supabase dashboard:");
    console.warn("   create policy \"anon select settings\" on public.settings for select to anon using (true);");
  }
  if (data?.printer_counter_ip) printerIPs.counter = data.printer_counter_ip;
  if (data?.printer_kitchen_ip) printerIPs.kitchen = data.printer_kitchen_ip;
  console.log(`🖨️  Counter: ${printerIPs.counter || "(not set)"}  |  Kitchen: ${printerIPs.kitchen || "(not set)"}`);
}

// ── Process a single print job ────────────────────────────────────────────────
async function processJob(job) {
  const { id, printer, payload } = job;
  // Reload IPs from settings on every job so changes saved in the UI take effect immediately
  await loadPrinterIPs();
  const ip = printer === "kitchen" ? printerIPs.kitchen : printerIPs.counter;

  console.log(`📄 Job ${id.slice(0, 8)}…  printer=${printer}  ip=${ip}  kind=${payload?.kind}`);

  let data;
  try {
    const kind = typeof payload === "string" ? JSON.parse(payload).kind : payload?.kind;
    if (kind === "receipt") {
      data = buildReceipt(typeof payload === "string" ? JSON.parse(payload) : payload);
    } else if (kind === "order_ticket" || printer === "kitchen") {
      data = buildKitchen(typeof payload === "string" ? JSON.parse(payload) : payload);
    } else {
      throw new Error(`Unknown job kind: ${kind}`);
    }
  } catch (e) {
    console.error(`   ❌ Format error: ${e.message}`);
    await supabase.from("print_jobs").update({ status: "failed", error: e.message }).eq("id", id);
    return;
  }

  try {
    await sendToPrinter(ip, data);
    await supabase.from("print_jobs").update({ status: "printed", printed_at: new Date().toISOString() }).eq("id", id);
    console.log(`   ✅ Printed (${data.length} bytes)`);
  } catch (e) {
    console.error(`   ❌ Send error: ${e.message}`);
    await supabase.from("print_jobs").update({ status: "failed", error: e.message }).eq("id", id);
  }
}

// ── Drain any pending jobs from before bridge started ─────────────────────────
async function drainPending() {
  const { data: jobs, error } = await supabase
    .from("print_jobs")
    .select("*")
    .eq("status", "pending")
    .order("created_at");
  if (error) {
    console.error(`❌  Cannot read print_jobs: ${error.message}`);
    console.error("   Run these SQL policies in Supabase dashboard:");
    console.error("   create policy \"anon select print_jobs\" on public.print_jobs for select to anon using (true);");
    console.error("   create policy \"anon update print_jobs\" on public.print_jobs for update to anon using (true) with check (true);");
    console.error("   create policy \"anon select settings\"  on public.settings   for select to anon using (true);");
    return;
  }
  if (!jobs?.length) { console.log("✓  No pending jobs in queue."); return; }
  console.log(`⏳  ${jobs.length} pending job(s) in queue — processing…`);
  for (const job of jobs) await processJob(job);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🚀  ESC/POS Print Bridge starting…");
  await loadPrinterIPs();
  await drainPending();

  // Realtime subscription — instant print on new job insert
  const channel = supabase
    .channel("print_jobs")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "print_jobs" },
      (payload) => {
        const job = payload.new;
        if (job.status === "pending") processJob(job);
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") console.log("📡  Realtime subscribed — waiting for print jobs…");
      if (status === "CLOSED")     console.log("⚠️   Realtime closed");
    });

  // Heartbeat log every 60s so you know the bridge is alive
  setInterval(() => process.stdout.write("."), 60_000);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n👋  Shutting down…");
    await supabase.removeChannel(channel);
    process.exit(0);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
