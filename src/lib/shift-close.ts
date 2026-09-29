import { supabase } from "@/integrations/supabase/client";

export type ShiftCloseBlockers = {
  has_blockers: boolean;
  open_orders: Array<{ id: string; order_number: string | null; source: string; table_code: string | null; amount: number }>;
  open_bills: Array<{ id: string; order_id: string; total: number }>;
  active_tables: Array<{ id: string; code: string; status: string }>;
  loyalty_issues: Array<{ id: string; points_redeemed: number; loyalty_discount_amount: number; expected_discount: number | null }>;
};

export type SafeCloseResult = {
  closed: boolean;
  reason?: "blocked" | "already_closed";
  blockers?: ShiftCloseBlockers;
};

const emptyBlockers = (): ShiftCloseBlockers => ({
  has_blockers: false,
  open_orders: [],
  open_bills: [],
  active_tables: [],
  loyalty_issues: [],
});

export async function getShiftCloseBlockers(shiftId: string): Promise<ShiftCloseBlockers> {
  const { data, error } = await supabase.rpc("get_shift_close_blockers", { p_shift_id: shiftId });
  if (error) throw error;
  return (data as ShiftCloseBlockers | null) ?? emptyBlockers();
}

export async function closeShiftSafely(args: {
  shiftId: string;
  closedBy: string | null | undefined;
  cashCount: Record<number, number>;
  totals: Record<string, unknown>;
}): Promise<SafeCloseResult> {
  const { data, error } = await supabase.rpc("close_shift_safely", {
    p_shift_id: args.shiftId,
    p_closed_by: args.closedBy ?? null,
    p_cash_count: args.cashCount,
    p_totals: args.totals,
  });
  if (error) throw error;
  return data as SafeCloseResult;
}

export function shiftCloseBlockedMessage(blockers: ShiftCloseBlockers): string {
  const details: string[] = [];
  if (blockers.active_tables.length) {
    details.push(`Active tables: ${blockers.active_tables.map((table) => table.code).join(", ")}`);
  }
  if (blockers.open_orders.length) {
    const orders = blockers.open_orders.map((order) => {
      const label = order.table_code
        ? `Table ${order.table_code}`
        : order.source === "takeout"
          ? "Takeout"
          : order.source === "staff_meal"
            ? "Staff meal"
            : "Order";
      return `${label}${order.order_number ? ` #${order.order_number}` : ""} (฿${Number(order.amount).toFixed(2)})`;
    });
    details.push(`Open orders: ${orders.join(", ")}`);
  }
  if (blockers.open_bills.length) details.push(`Unpaid bills: ${blockers.open_bills.length}`);
  if (blockers.loyalty_issues?.length) details.push(`Member discount errors: ${blockers.loyalty_issues.length}`);
  return `Z report blocked. Settle or close everything first. ${details.join(" · ")}`;
}
