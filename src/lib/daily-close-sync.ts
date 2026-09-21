import { supabase } from "@/integrations/supabase/client";

export type DailyCloseSyncResult = {
  ok: boolean;
  enabled?: boolean;
  status?: string;
  error?: string;
};

/**
 * Queue/send one closed shift to Manager. The server feature flag remains off
 * until dry-run day, so shipping this client code cannot upload early.
 */
export async function syncDailyClose(shiftId: string): Promise<DailyCloseSyncResult> {
  const { data, error } = await supabase.functions.invoke("sync-daily-close", {
    body: { shiftId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as DailyCloseSyncResult;
}

/** Retry old unsent Z-closes when Register/Reports is opened. */
export async function retryPendingDailyCloses(): Promise<void> {
  const { data, error } = await (supabase as any)
    .from("daily_close_sync_outbox")
    .select("shift_id")
    .in("status", ["ready", "failed", "disabled"])
    .order("created_at", { ascending: true })
    .limit(10);
  if (error) return;
  for (const row of data ?? []) {
    try { await syncDailyClose(row.shift_id); } catch { /* retained in outbox */ }
  }
}
