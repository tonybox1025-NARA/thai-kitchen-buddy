import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { printDirect, type CounterPrintPayload } from "@/lib/counter-printer";
import { isNativeApp } from "@/lib/print/native-printer";

type PrintJob = {
  id: string;
  printer: Database["public"]["Enums"]["printer_kind"];
  payload: Json;
  status: Database["public"]["Enums"]["print_status"];
  error?: string | null;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function retryableConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to connect|connection refused|timeout|timed out|socket/i.test(message);
}

async function printWithConnectionRetry(job: PrintJob) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await printDirect(job.printer, job.payload as unknown as CounterPrintPayload);
      return;
    } catch (error) {
      lastError = error;
      if (!retryableConnectionError(error) || attempt === 4) throw error;
      await delay(600 * attempt);
    }
  }
  throw lastError;
}

// QR orders originate on the customer's phone, which cannot reach printers on
// the restaurant LAN. The public API stores their tickets in print_jobs; the
// authenticated native POS consumes those jobs and sends them over LAN/SUNMI.
// This replaces the old anonymous bridge without reopening print_jobs to anon.
export function useNativePrintQueue(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !isNativeApp()) return;

    let stopped = false;
    const seen = new Set<string>();
    let chain = Promise.resolve();

    const process = async (job: PrintJob) => {
      if (stopped || job.status !== "pending" || seen.has(job.id)) return;
      seen.add(job.id);
      try {
        await printWithConnectionRetry(job);
        await supabase
          .from("print_jobs")
          .update({ status: "printed", printed_at: new Date().toISOString(), error: null })
          .eq("id", job.id)
          .eq("status", "pending");
      } catch (error) {
        await supabase
          .from("print_jobs")
          .update({ status: "failed", error: error instanceof Error ? error.message : String(error) })
          .eq("id", job.id)
          .eq("status", "pending");
      } finally {
        // Cheap ESC/POS network printers often refuse a second socket opened
        // immediately after the first ticket. Keep destinations serialized and
        // give the printer time to release port 9100 before the next job.
        await delay(1000);
      }
    };

    const enqueue = (job: PrintJob) => {
      chain = chain.then(() => process(job), () => process(job));
    };

    const recoverPending = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("print_jobs")
        .select("id,printer,payload,status,error")
        .eq("status", "pending")
        .gte("created_at", cutoff)
        .order("created_at");
      for (const row of data ?? []) enqueue(row as PrintJob);
    };

    // Recover recent tickets if the POS was closed or updating when the guest
    // submitted. The cutoff prevents an old forgotten backlog from printing.
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    void supabase
      .from("print_jobs")
      .select("id,printer,payload,status,error")
      .in("status", ["pending", "failed"])
      .gte("created_at", cutoff)
      .order("created_at")
      .then(async ({ data }) => {
        for (const row of data ?? []) {
          const job = row as PrintJob;
          if (job.status === "failed") {
            if (!retryableConnectionError(job.error)) continue;
            const { data: reset } = await supabase
              .from("print_jobs")
              .update({ status: "pending", error: null })
              .eq("id", job.id)
              .eq("status", "failed")
              .select("id,printer,payload,status,error")
              .maybeSingle();
            if (reset) enqueue(reset as PrintJob);
          } else {
            enqueue(job);
          }
        }
      });

    const channel = supabase
      .channel(`native-print-queue-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "print_jobs" },
        (event) => enqueue(event.new as PrintJob),
      )
      .subscribe();

    // Realtime is an accelerator, not the only delivery mechanism. Android can
    // suspend the websocket while the screen sleeps or Wi-Fi roams; polling the
    // tiny pending set prevents a successful queue insert from remaining stuck.
    const poll = window.setInterval(() => void recoverPending(), 4_000);
    const onFocus = () => void recoverPending();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      stopped = true;
      window.clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [enabled]);
}
