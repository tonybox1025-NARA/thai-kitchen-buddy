import { supabase } from "@/integrations/supabase/client";

const COUNTER_BRIDGE_URL = "http://127.0.0.1:9001/print/counter";
const COUNTER_BRIDGE_IMAGE_URL = "http://127.0.0.1:9001/print/counter-img";

export type CounterPrintPayload = Record<string, unknown> & {
  kind: "receipt" | "order_ticket";
};

export async function printCounter(payload: CounterPrintPayload) {
  try {
    await printCounterViaAndroidBridge(payload);
    return { ok: true, via: "android-bridge" as const };
  } catch (error) {
    console.warn("[counter-printer] Android bridge failed, queueing print_jobs fallback", error);
    await supabase.from("print_jobs").insert({
      printer: "counter",
      payload,
    });
    return { ok: false, via: "print_jobs-fallback" as const, error };
  }
}

export async function printCounterViaAndroidBridge(payload: CounterPrintPayload) {
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
