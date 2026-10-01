import { supabase } from "@/integrations/supabase/client";

type OpenTableOrderInput = {
  tableId: string;
  guests: number;
  openedBy: string | null;
  shiftId?: string | null;
  source?: "pos" | "qr";
  isTest?: boolean;
};

type OpenTableOrderResult = {
  orderId: string;
  created: boolean;
};

const retryable = (message: string) => /abort|fetch|network|timeout/i.test(message);

/**
 * The only browser entry point for opening a seated table.
 *
 * The database function serializes attempts for the same table and adopts the
 * existing order when another device wins the race. Network failures are
 * retried here because repeating this RPC is idempotent.
 */
export async function openTableOrder(input: OpenTableOrderInput): Promise<OpenTableOrderResult> {
  let lastError = "No response";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6_000);
    try {
      const { data, error } = await (supabase as any).rpc("open_table_order_safely", {
        p_table_id: input.tableId,
        p_shift_id: input.shiftId ?? null,
        p_guests: Math.max(1, input.guests),
        p_opened_by: input.openedBy,
        p_source: input.source ?? "pos",
        p_is_test: input.isTest ?? false,
      }).abortSignal(controller.signal);

      const row = data?.[0];
      if (!error && row?.order_id) {
        return { orderId: row.order_id, created: Boolean(row.created) };
      }

      lastError = error?.message ?? "No response";
      if (!retryable(lastError)) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (!retryable(lastError)) break;
    } finally {
      window.clearTimeout(timeout);
    }

    await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
  }

  throw new Error(lastError);
}
