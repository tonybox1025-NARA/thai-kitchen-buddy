import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { buildEscPos, toBase64, type PrintPayload } from "@/lib/print/raster";
import { PosPrinter, isNativeApp } from "@/lib/print/native-printer";

const COUNTER_BRIDGE_URL = "http://127.0.0.1:9001/print/counter";
const COUNTER_BRIDGE_IMAGE_URL = "http://127.0.0.1:9001/print/counter-img";

export type PrinterName = "counter" | "kitchen";

export type CounterPrintPayload = Record<string, unknown> & {
  kind: "receipt" | "order_ticket" | "table_qr";
};

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
  return localStorage.getItem(TRANSPORT_KEY) === "direct" ? "direct" : "queue";
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

/** Today's path: hand the job to print_jobs for the bridge to print. */
export async function queuePrintJob(printer: PrinterName, payload: CounterPrintPayload) {
  const { error } = await supabase.from("print_jobs").insert({
    printer,
    payload: payload as Json,
  });
  if (error) throw error;
  return { ok: true as const, via: "print_jobs" as const };
}

/** Compose ESC/POS in the app and write it to the printer over the native bridge. */
export async function printDirect(printer: PrinterName, payload: CounterPrintPayload) {
  const data = toBase64(await buildEscPos(payload as unknown as PrintPayload, printer));

  const { available } = await PosPrinter.sunmiStatus().catch(() => ({ available: false }));
  if (available) {
    await PosPrinter.printSunmi({ data });
    return { ok: true as const, via: "sunmi" as const };
  }

  // The kitchen printer is on the LAN; only the counter can be cabled over USB.
  if (printer === "counter" && getCounterLink() === "usb") {
    await PosPrinter.printUsb({ data });
    return { ok: true as const, via: "usb" as const };
  }

  const ips = await loadPrinterIps(true);
  const host = printer === "kitchen" ? ips.kitchen : ips.counter;
  if (!host) {
    throw new Error(
      `No IP configured for the ${printer} printer — set it in Settings, or switch the counter printer to USB.`,
    );
  }
  await PosPrinter.printTcp({ host, data });
  return { ok: true as const, via: "tcp" as const };
}

/** Check a printer answers, without printing. Native only. */
export async function probePrinter(printer: PrinterName) {
  const ips = await loadPrinterIps(true);
  const host = printer === "kitchen" ? ips.kitchen : ips.counter;
  if (!host) return { reachable: false, error: "No IP configured" };
  return PosPrinter.probeTcp({ host });
}

/**
 * Send one job by whichever transport this device is set to.
 * Falls back to the queue whenever direct printing is unavailable, so a
 * misconfigured tablet degrades to today's behaviour instead of losing the ticket.
 */
export async function printJob(printer: PrinterName, payload: CounterPrintPayload) {
  if (getPrintTransport() === "direct" && canPrintDirect()) {
    return printDirect(printer, payload);
  }
  return queuePrintJob(printer, payload);
}

/** Send a batch of kitchen tickets (one per zone) by the active transport. */
export async function printKitchenJobs(
  jobs: { printer: PrinterName; payload: CounterPrintPayload }[],
) {
  if (jobs.length === 0) return;

  if (getPrintTransport() === "direct" && canPrintDirect()) {
    for (const job of jobs) await printDirect(job.printer, job.payload);
    return;
  }

  const { error } = await supabase
    .from("print_jobs")
    .insert(jobs.map((j) => ({ printer: j.printer, payload: j.payload as Json })));
  if (error) throw error;
}

// ── Back-compat entry points ──────────────────────────────────────────────────

/** Counter/receipt print. Routes through the active transport. */
export async function printCounter(payload: CounterPrintPayload) {
  return printJob("counter", payload);
}

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
