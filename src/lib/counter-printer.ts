import { supabase } from "@/integrations/supabase/client";

const COUNTER_BRIDGE_URL = "http://127.0.0.1:9001/print/counter";

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

async function printCounterViaAndroidBridge(payload: CounterPrintPayload) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(COUNTER_BRIDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const message = await res.text().catch(() => "");
      throw new Error(`Counter bridge HTTP ${res.status}${message ? `: ${message}` : ""}`);
    }
  } finally {
    window.clearTimeout(timeout);
  }
}
