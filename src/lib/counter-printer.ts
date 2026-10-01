import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { buildEscPos, toBase64, type PrintPayload } from "@/lib/print/raster";
import { PosPrinter, isNativeApp } from "@/lib/print/native-printer";
import { aggregateReceiptItems } from "@/lib/print/aggregate-receipt-items";

const COUNTER_BRIDGE_URL = "http://127.0.0.1:9001/print/counter";
const COUNTER_BRIDGE_IMAGE_URL = "http://127.0.0.1:9001/print/counter-img";

export type PrinterName = "counter" | "kitchen";

export type CounterPrintPayload = Record<string, unknown> & {
  kind: "receipt" | "order_ticket" | "table_qr" | "report";
};

function preparePrintPayload(payload: CounterPrintPayload): CounterPrintPayload {
  if (payload.kind !== "receipt") return payload;
  return { ...payload, items: aggregateReceiptItems(payload.items) };
}

/**
 * How print jobs reach paper.
 *
 * - `queue`  — insert into print_jobs and let scripts/print-bridge.js pick it up.
 *              This is what the restaurant runs today and stays the default.
 * - `direct` — the Android app composes ESC/POS itself and writes straight to the
 *              printer (LAN socket, or the SUNMI internal printer). No bridge machine.
 *
 * Stored per device, because one till may be a SUNMI terminal while another is a
 * tablet pointed at a LAN printer.
 */
export type PrintTransport = "queue" | "direct";

const TRANSPORT_KEY = "pos.printTransport";

export function getPrintTransport(): PrintTransport {
  if (typeof localStorage === "undefined") return "queue";
  const saved = localStorage.getItem(TRANSPORT_KEY);
  if (saved === "direct" || saved === "queue") return saved;

  // Native POS builds have their own LAN/USB/SUNMI printer transport and do
  // not need the database queue. Defaulting an APK to the queue makes a
  // successful insert look like a successful print, and also couples printing
  // to a separately running bridge. Browsers still use the queue by default.
  return isNativeApp() ? "direct" : "queue";
}

export function setPrintTransport(transport: PrintTransport) {
  localStorage.setItem(TRANSPORT_KEY, transport);
}

/**
 * Which wire the counter (receipt) printer is on.
 *
 * The kitchen printer is always on the LAN. The counter printer is cabled to the till
 * over USB in the current setup, though its LAN port is preferred where available —
 * network printing works from any till, USB only from the one holding the cable.
 */
export type CounterLink = "network" | "usb";

const COUNTER_LINK_KEY = "pos.counterLink";

export function getCounterLink(): CounterLink {
  if (typeof localStorage === "undefined") return "network";
  return localStorage.getItem(COUNTER_LINK_KEY) === "usb" ? "usb" : "network";
}

export function setCounterLink(link: CounterLink) {
  localStorage.setItem(COUNTER_LINK_KEY, link);
}

/** Attached USB devices, for choosing the receipt printer in Settings. */
export async function listUsbPrinters() {
  const { devices } = await PosPrinter.usbDevices();
  return devices;
}

/** Direct printing needs the native transport; in a browser it is never available. */
export function canPrintDirect(): boolean {
  return isNativeApp();
}

// ── Printer addresses ─────────────────────────────────────────────────────────

type PrinterIps = { counter: string | null; kitchen: string | null };

let cachedIps: PrinterIps | null = null;

/**
 * Read printer addresses from the same settings row the Node bridge reads, so a
 * change saved in Settings applies to both paths.
 */
export async function loadPrinterIps(force = false): Promise<PrinterIps> {
  if (cachedIps && !force) return cachedIps;
  const { data } = await supabase
    .from("settings")
    .select("printer_counter_ip,printer_kitchen_ip")
    .eq("id", 1)
    .maybeSingle();
  cachedIps = {
    counter: data?.printer_counter_ip ?? null,
    kitchen: data?.printer_kitchen_ip ?? null,
  };
  return cachedIps;
}

export function invalidatePrinterIps() {
  cachedIps = null;
}

// ── Transports ────────────────────────────────────────────────────────────────

/** Compose ESC/POS in the app and write it to the printer over the native bridge. */
export async function printDirect(printer: PrinterName, payload: CounterPrintPayload) {
  const prepared = preparePrintPayload(payload);
  const data = toBase64(await buildEscPos(prepared as unknown as PrintPayload, printer));

  // The kitchen printer is on the LAN; only the counter can be cabled over USB.
  if (printer === "counter" && getCounterLink() === "usb") {
    await PosPrinter.printUsb({ data });
    return { ok: true as const, via: "usb" as const };
  }

  // Prefer the configured network printer. Many SUNMI terminals ship the built-in
  // printer *service* (woyou.aidlservice.jiuiv5) even with no physical printer —
  // e.g. the D3 PRO — so sunmiStatus() reporting "available" must NOT override an
  // IP the owner set, or every job vanishes into a printer that isn't there.
  const ips = await loadPrinterIps(true);
  const host = printer === "kitchen" ? ips.kitchen : ips.counter;
  if (host) {
    await PosPrinter.printTcp({ host, data });
    return { ok: true as const, via: "tcp" as const };
  }

  // No LAN/USB target configured → use a real SUNMI built-in printer if present.
  const { available } = await PosPrinter.sunmiStatus().catch(() => ({ available: false }));
  if (available) {
    await PosPrinter.printSunmi({ data });
    return { ok: true as const, via: "sunmi" as const };
  }

  throw new Error(
    `No IP configured for the ${printer} printer — set it in Settings, or switch the counter printer to USB.`,
  );
}

/** Check a printer answers, without printing. Native only. */
export async function probePrinter(printer: PrinterName) {
  const ips = await loadPrinterIps(true);
  const host = printer === "kitchen" ? ips.kitchen : ips.counter;
  if (!host) return { reachable: false, error: "No IP configured" };
  return PosPrinter.probeTcp({ host });
}

/**
 * Pulse the cash-drawer port on the counter printer (ESC p, pin 2).
 *
 * The drawer is physically attached to the receipt printer, so this follows the
 * same per-device USB/LAN/SUNMI route as counter receipts. It is intentionally
 * native-only: a browser must never report success for a drawer it cannot reach.
 */
export async function openCashDrawer() {
  if (!canPrintDirect()) {
    throw new Error("Cash drawer control is available only in the LONMOH POS app.");
  }

  // ESC p m t1 t2 — standard drawer-kick pulse, connector pin 2.
  const data = toBase64(new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa]));

  if (getCounterLink() === "usb") {
    await PosPrinter.printUsb({ data });
    return;
  }

  const { counter: host } = await loadPrinterIps(true);
  if (host) {
    await PosPrinter.printTcp({ host, data });
    return;
  }

  const { available } = await PosPrinter.sunmiStatus().catch(() => ({ available: false }));
  if (available) {
    await PosPrinter.printSunmi({ data });
    return;
  }

  throw new Error("No counter printer configured for the cash drawer.");
}

/**
 * Operational printing. Every operational ticket is recorded durably in the
 * print_jobs outbox first (idempotent per job key) and delivered by the
 * native leased worker or the print bridge with automatic retries. Direct
 * printer writes are reserved for test prints and the cash drawer.
 *
 * Pass a deterministic `jobKey` for anything that may be retried (receipts,
 * tickets). Explicit reprints should pass their own fresh key.
 */
export type OperationalPrintOptions = {
  jobKey?: string;
  sourceType?: string;
  sourceId?: string | null;
  batchId?: string | null;
};

function operationalKey(prefix: string, opts?: OperationalPrintOptions) {
  return opts?.jobKey ?? `${prefix}:${crypto.randomUUID()}`;
}

export async function printJob(printer: PrinterName, payload: CounterPrintPayload, opts?: OperationalPrintOptions) {
  const id = await enqueueDurablePrint({
    jobKey: operationalKey(`adhoc:${printer}`, opts),
    printer,
    payload,
    sourceType: opts?.sourceType ?? "adhoc",
    sourceId: opts?.sourceId ?? null,
    batchId: opts?.batchId ?? null,
  });
  return { ok: true as const, via: "outbox" as const, id };
}

/** Record kitchen tickets (one per zone) in the durable outbox. */
export async function printKitchenJobs(
  jobs: { printer: PrinterName; payload: CounterPrintPayload }[],
  opts?: OperationalPrintOptions,
) {
  const base = operationalKey("kitchen", opts);
  for (const [i, job] of jobs.entries()) {
    await enqueueDurablePrint({
      jobKey: `${base}:${job.printer}:${i + 1}`,
      printer: job.printer,
      payload: job.payload,
      sourceType: opts?.sourceType ?? "adhoc",
      sourceId: opts?.sourceId ?? null,
    });
  }
}

/**
 * Record several counter tickets as one outbox batch so the worker delivers
 * them in a single transport write (each document carries its own cut).
 */
export async function printCounterJobs(payloads: CounterPrintPayload[], opts?: OperationalPrintOptions) {
  if (payloads.length === 0) return;
  const base = operationalKey("counter", opts);
  const batchId = payloads.length > 1 ? crypto.randomUUID() : null;
  for (const [i, payload] of payloads.entries()) {
    await enqueueDurablePrint({
      jobKey: `${base}:counter:${i + 1}`,
      printer: "counter",
      payload,
      sourceType: opts?.sourceType ?? "adhoc",
      sourceId: opts?.sourceId ?? null,
      batchId,
    });
  }
}

// ── Back-compat entry points ──────────────────────────────────────────────────

/** Counter/receipt print, recorded durably in the outbox. */
export async function printCounter(payload: CounterPrintPayload, opts?: OperationalPrintOptions) {
  return printJob("counter", payload, opts);
}

/** Test-print only: writes straight to the printer / local bridge. */
export async function printCounterViaAndroidBridge(payload: CounterPrintPayload) {
  // In the APK there is no loopback bridge to talk to — print natively instead.
  if (canPrintDirect()) {
    await printDirect("counter", payload);
    return;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  try {
    await postJson(payload, controller.signal);
  } catch (error) {
    if (error instanceof TypeError) {
      try {
        await postNoCors(payload);
      } catch {
        await printViaImageRequest(payload);
      }
      return;
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function postJson(payload: CounterPrintPayload, signal: AbortSignal) {
  const res = await fetch(COUNTER_BRIDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const message = await res.text().catch(() => "");
    throw new Error(`Counter bridge HTTP ${res.status}${message ? `: ${message}` : ""}`);
  }
}

async function postNoCors(payload: CounterPrintPayload) {
  await fetch(COUNTER_BRIDGE_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(payload),
  });
}

function printViaImageRequest(payload: CounterPrintPayload) {
  return new Promise<void>((resolve) => {
    const img = new Image();
    const cleanup = () => {
      img.onload = null;
      img.onerror = null;
      resolve();
    };
    img.onload = cleanup;
    img.onerror = cleanup;
    window.setTimeout(cleanup, 3_000);
    img.src = `${COUNTER_BRIDGE_IMAGE_URL}?payload=${encodeURIComponent(base64UrlEncode(JSON.stringify(payload)))}&t=${Date.now()}`;
  });
}

function base64UrlEncode(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── Durable outbox ────────────────────────────────────────────────────────────

/**
 * Record a print job durably under a deterministic key. Repeating the same key
 * never creates a second ticket; the native worker delivers it with retries.
 */
export async function enqueueDurablePrint(args: {
  jobKey: string;
  printer: PrinterName;
  payload: CounterPrintPayload;
  sourceType?: string;
  sourceId?: string | null;
  batchId?: string | null;
}) {
  const { data, error } = await (supabase as any).rpc("enqueue_print_job", {
    p_job_key: args.jobKey,
    p_printer: args.printer,
    p_payload: preparePrintPayload(args.payload) as Json,
    p_source_type: args.sourceType ?? null,
    p_source_id: args.sourceId ?? null,
    p_batch_id: args.batchId ?? null,
  });
  if (error) throw error;
  return data as string;
}

/** Prepare a payload for storing in an outbox RPC argument. */
export function preparePayloadForOutbox(payload: CounterPrintPayload) {
  return preparePrintPayload(payload) as Json;
}

/**
 * Deliver several already-recorded documents to one printer in a single
 * transport write (each document carries its own cut), used by the worker.
 */
export async function printDirectBatch(printer: PrinterName, payloads: CounterPrintPayload[]) {
  if (payloads.length === 0) return;
  if (payloads.length === 1) {
    await printDirect(printer, payloads[0]);
    return;
  }
  const documents = await Promise.all(
    payloads.map((p) => buildEscPos(preparePrintPayload(p) as unknown as PrintPayload, printer)),
  );
  const batch = new Uint8Array(documents.reduce((n, d) => n + d.length, 0));
  let offset = 0;
  for (const d of documents) { batch.set(d, offset); offset += d.length; }
  const data = toBase64(batch);
  if (printer === "counter" && getCounterLink() === "usb") { await PosPrinter.printUsb({ data }); return; }
  const ips = await loadPrinterIps(true);
  const host = printer === "kitchen" ? ips.kitchen : ips.counter;
  if (host) { await PosPrinter.printTcp({ host, data }); return; }
  const { available } = await PosPrinter.sunmiStatus().catch(() => ({ available: false }));
  if (available) { await PosPrinter.printSunmi({ data }); return; }
  throw new Error(`No ${printer} printer configured`);
}
