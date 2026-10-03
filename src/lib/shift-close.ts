import { supabase } from "@/integrations/supabase/client";

export type ShiftCloseBlockers = {
  has_blockers: boolean;
  open_orders: Array<{
    id: string;
    order_number: string | null;
    source: string;
    table_code: string | null;
    amount: number;
  }>;
  open_bills: Array<{ id: string; order_id: string; total: number }>;
  active_tables: Array<{ id: string; code: string; status: string }>;
  loyalty_issues: Array<{
    id: string;
    points_redeemed: number;
    loyalty_discount_amount: number;
    expected_discount: number | null;
  }>;
  manager_review_count?: number;
  auto_resolved_count?: number;
};

export type SafeCloseResult = {
  closed: boolean;
  reason?: "blocked" | "already_closed";
  blockers?: ShiftCloseBlockers;
  manager_review_count?: number;
  auto_resolved_count?: number;
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
  const { data, error } = await (supabase as any).rpc("close_shift_safely", {
    p_shift_id: args.shiftId,
    p_closed_by: args.closedBy ?? null,
    p_cash_count: args.cashCount,
    p_totals: args.totals,
  });
  if (error) throw error;
  return data as SafeCloseResult;
}

export function shiftCloseBlockedMessage(
  blockers: ShiftCloseBlockers,
  lang: "th" | "en" = "en",
): string {
  if (lang === "th") {
    const details: string[] = [];
    if (blockers.active_tables.length) {
      details.push(
        `โต๊ะที่ยังใช้งาน: ${blockers.active_tables.map((table) => table.code).join(", ")}`,
      );
    }
    if (blockers.open_orders.length)
      details.push(`ออเดอร์ที่ต้องตรวจสอบ: ${blockers.open_orders.length}`);
    if (blockers.open_bills.length)
      details.push(`บิลที่ต้องตรวจสอบ: ${blockers.open_bills.length}`);
    if (blockers.loyalty_issues?.length)
      details.push(`ข้อผิดพลาดส่วนลดสมาชิก: ${blockers.loyalty_issues.length}`);
    return `มีรายการที่ผู้จัดการต้องตรวจสอบ${details.length ? ` · ${details.join(" · ")}` : ""}`;
  }
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
  if (blockers.open_bills.length)
    details.push(`Bill records to review: ${blockers.open_bills.length}`);
  if (blockers.loyalty_issues?.length)
    details.push(`Member discount errors: ${blockers.loyalty_issues.length}`);
  return `Closing records need manager review. ${details.join(" · ")}`;
}

export type OpenShiftResult<S> = { created: boolean; shift: S };

/** Atomic, idempotent open. Repeated taps/timeouts return the committed shift. */
export async function openShiftSafely<S>(args: {
  openedBy: string | null | undefined;
  openingFloat: number;
  businessDay: string;
  printJobs: Array<{ printer: "counter" | "kitchen"; payload: unknown }>;
}): Promise<OpenShiftResult<S>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await (supabase as any).rpc("open_shift_safely", {
      p_opened_by: args.openedBy ?? null,
      p_opening_float: args.openingFloat,
      p_business_day: args.businessDay,
      p_print_jobs: args.printJobs,
    });
    if (!error && data) return data as OpenShiftResult<S>;
    lastError = error;
    if (!/fetch|network|timeout|abort/i.test(String(error?.message ?? ""))) break;
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String((lastError as any)?.message ?? lastError));
}

export type CloseWithTicketResult = SafeCloseResult & { adopted?: boolean };

/** Z close + Z ticket in one transaction. A repeat call adopts the committed close. */
export async function closeShiftWithTicket(args: {
  shiftId: string;
  closedBy: string | null | undefined;
  cashCount: Record<number, number>;
  totals: Record<string, unknown>;
  printPayload: unknown | null;
}): Promise<CloseWithTicketResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await (supabase as any).rpc("close_shift_with_ticket", {
      p_shift_id: args.shiftId,
      p_closed_by: args.closedBy ?? null,
      p_cash_count: args.cashCount,
      p_totals: args.totals,
      p_print_payload: args.printPayload,
    });
    if (!error && data) return data as CloseWithTicketResult;
    lastError = error;
    if (!/fetch|network|timeout|abort/i.test(String(error?.message ?? ""))) break;
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String((lastError as any)?.message ?? lastError));
}
