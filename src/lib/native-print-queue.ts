import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { printDirectBatch, type CounterPrintPayload } from "@/lib/counter-printer";
import { isNativeApp } from "@/lib/print/native-printer";

type PrintJob = {
  id: string;
  printer: Database["public"]["Enums"]["printer_kind"];
  payload: Json;
  batch_id: string | null;
  created_at: string;
};

// ── Small observable for the non-blocking "printing…" indicator ──────────────
type QueueStatus = { pending: number; oldestSeconds: number };
let status: QueueStatus = { pending: 0, oldestSeconds: 0 };
const listeners = new Set<() => void>();
function setStatus(next: QueueStatus) {
  if (next.pending === status.pending && next.oldestSeconds === status.oldestSeconds) return;
  status = next;
  listeners.forEach((l) => l());
}
export function usePrintQueueStatus(): QueueStatus {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => status,
    () => status,
  );
}

function deviceId(): string {
  const KEY = "pos.print.device_id";
  try {
    let id = localStorage.getItem(KEY);
    if (!id) { id = `till-${crypto.randomUUID()}`; localStorage.setItem(KEY, id); }
    return id;
  } catch {
    return `till-${crypto.randomUUID()}`;
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Durable print worker for the native POS.
 *
 * Every operational ticket is first committed to print_jobs (by the RPC that
 * committed the business action). This worker claims jobs through a leased
 * RPC — one printer at a time across all tills — prints, then completes or
 * schedules a capped exponential retry. Nothing is ever abandoned: after an
 * app/device/network restart the next claim picks up whatever is still due.
 */
export function useNativePrintQueue(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !isNativeApp()) return;

    const device = deviceId();
    let stopped = false;
    let running = false;
    let again = false;

    const refreshStatus = async () => {
      const { data } = await supabase
        .from("print_jobs")
        .select("created_at")
        .eq("status", "pending")
        .order("created_at")
        .limit(50);
      const rows = data ?? [];
      setStatus({
        pending: rows.length,
        oldestSeconds: rows[0] ? Math.max(0, Math.round((Date.now() - new Date(rows[0].created_at).getTime()) / 1000)) : 0,
      });
    };

    const drain = async () => {
      if (stopped) return;
      if (running) { again = true; return; }
      running = true;
      try {
        do {
          again = false;
          const { data, error } = await (supabase as any).rpc("claim_print_jobs", { p_device: device, p_lease_seconds: 90 });
          if (error || !data?.length) break;
          const byPrinter = new Map<string, PrintJob[]>();
          for (const job of data as PrintJob[]) {
            const list = byPrinter.get(job.printer) ?? [];
            list.push(job);
            byPrinter.set(job.printer, list);
          }
          // Printers are independent; jobs for one printer are one claimed unit.
          await Promise.all([...byPrinter.entries()].map(async ([printer, jobs]) => {
            jobs.sort((a, b) => a.created_at.localeCompare(b.created_at));
            try {
              await printDirectBatch(printer as PrintJob["printer"], jobs.map((j) => j.payload as unknown as CounterPrintPayload));
              for (const j of jobs) await (supabase as any).rpc("complete_print_job", { p_id: j.id, p_device: device });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              for (const j of jobs) await (supabase as any).rpc("fail_print_job", { p_id: j.id, p_device: device, p_error: message });
            }
          }));
          // Cheap LAN printers refuse a socket opened immediately after the last.
          await delay(1000);
          again = true;
        } while (again && !stopped);
      } finally {
        running = false;
        void refreshStatus();
      }
    };

    void drain();

    const channel = supabase
      .channel(`native-print-queue-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "print_jobs" }, () => void drain())
      .subscribe();

    // Realtime is only an accelerator; polling covers sleep/Wi-Fi roaming and
    // retries whose backoff has elapsed.
    const poll = window.setInterval(() => void drain(), 4_000);
    // Safe self-heal of table projection drift (audited, never touches money).
    const heal = window.setInterval(() => void (supabase as any).rpc("heal_table_projection"), 5 * 60_000);
    const onWake = () => void drain();
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onWake);

    return () => {
      stopped = true;
      window.clearInterval(poll);
      window.clearInterval(heal);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onWake);
      void supabase.removeChannel(channel);
    };
  }, [enabled]);
}
