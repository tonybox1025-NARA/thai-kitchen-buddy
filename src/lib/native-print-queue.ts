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
};

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
        await printDirect(job.printer, job.payload as unknown as CounterPrintPayload);
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
      }
    };

    const enqueue = (job: PrintJob) => {
      chain = chain.then(() => process(job), () => process(job));
    };

    // Recover recent tickets if the POS was closed or updating when the guest
    // submitted. The cutoff prevents an old forgotten backlog from printing.
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    void supabase
      .from("print_jobs")
      .select("id,printer,payload,status")
      .eq("status", "pending")
      .gte("created_at", cutoff)
      .order("created_at")
      .then(({ data }) => {
        for (const job of data ?? []) enqueue(job as PrintJob);
      });

    const channel = supabase
      .channel(`native-print-queue-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "print_jobs" },
        (event) => enqueue(event.new as PrintJob),
      )
      .subscribe();

    return () => {
      stopped = true;
      void supabase.removeChannel(channel);
    };
  }, [enabled]);
}
