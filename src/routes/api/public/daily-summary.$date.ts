import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";
import { bangkokDayUtcBounds } from "@/lib/business-day";
import { countedCashAfterOpening, totalCashCount } from "@/lib/cash-denominations";
import { calculateKbankSettlement, previousDateKey } from "@/lib/kbank-settlement";

// Daily sales summary for a business day, shaped to fill the LONMOH Manager app's
// Daily Sales Entry. Read-only aggregate over paid, non-test bills. Uses a path
// param ($date) — plain no-param GET API routes don't get bundled as handlers.
// Called cross-origin from the Manager app, so CORS is allowed. Key-gated.
const SYNC_KEY = "lm-sync-2f9a7c3e8b14";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function createPublicServerClient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

const sum = (rows: any[], f: (r: any) => number) =>
  rows.reduce((s, r) => s + (Number(f(r)) || 0), 0);
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

export const Route = createFileRoute("/api/public/daily-summary/$date")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ params, request }) => {
        const supabase = createPublicServerClient();
        if (!supabase) return new Response("Unavailable", { status: 503, headers: CORS });

        const date = params.date; // YYYY-MM-DD (business day)
        const key = new URL(request.url).searchParams.get("key");
        if (key !== SYNC_KEY) return json({ error: "Unauthorized" }, 401);
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Bad date" }, 400);

        const sb = supabase as any;

        const [openedFrom, openedBefore] = bangkokDayUtcBounds(date);
        const previousDate = previousDateKey(date);
        const [previousOpenedFrom, previousOpenedBefore] =
          bangkokDayUtcBounds(previousDate);
        const [{ data: shifts }, { data: previousShifts }] = await Promise.all([
          sb
            .from("shifts")
            .select("id,status,opening_float,cash_count")
            .gte("opened_at", openedFrom)
            .lt("opened_at", openedBefore),
          sb
            .from("shifts")
            .select("id")
            .gte("opened_at", previousOpenedFrom)
            .lt("opened_at", previousOpenedBefore),
        ]);
        const shiftIds = (shifts ?? []).map((s: any) => s.id);
        const previousShiftIds = (previousShifts ?? []).map((s: any) => s.id);
        if (shiftIds.length === 0) return json({ date, bill_count: 0, has_data: false });

        const { data: bills } = await sb
          .from("bills")
          .select(
            "id,subtotal,total,member_discount_amount,loyalty_discount_amount,discount_amount,vat_amount",
          )
          .in("shift_id", shiftIds)
          .in("status", ["paid", "partial_refund", "refunded"])
          .not("is_test", "is", true);
        const billRows = bills ?? [];
        const billIds = billRows.map((b: any) => b.id);

        const { data: previousBills } = previousShiftIds.length
          ? await sb
              .from("bills")
              .select("id")
              .in("shift_id", previousShiftIds)
              .in("status", ["paid", "partial_refund", "refunded"])
              .not("is_test", "is", true)
          : { data: [] };
        const previousBillIds = (previousBills ?? []).map((b: any) => b.id);

        const [
          { data: pays },
          { data: refunds },
          { data: staffCharges },
          { data: staffSettlements },
          { data: previousQrPays },
        ] = await Promise.all([
          billIds.length
            ? sb
                .from("payments")
                .select("method,amount,tip_amount,created_at")
                .in("bill_id", billIds)
            : Promise.resolve({ data: [] }),
          sb.from("refunds").select("amount").in("shift_id", shiftIds),
          sb
            .from("staff_tab_charges")
            .select("subtotal,discount_amount,amount")
            .in("shift_id", shiftIds)
            .neq("status", "voided"),
          sb.from("staff_tab_settlements").select("amount,method").in("shift_id", shiftIds),
          previousBillIds.length
            ? sb
                .from("payments")
                .select("amount,tip_amount,created_at")
                .in("bill_id", previousBillIds)
                .eq("method", "qr")
            : Promise.resolve({ data: [] }),
        ]);
        const payRows = pays ?? [];
        const byMethod = (m: string) =>
          sum(
            payRows.filter((p: any) => p.method === m),
            (p: any) => p.amount,
          );
        const tipsByMethod = (m: string) =>
          sum(
            payRows.filter((p: any) => p.method === m),
            (p: any) => p.tip_amount,
          );

        const refundTotal = sum(refunds ?? [], (r) => r.amount);
        const staffChargeRows = staffCharges ?? [];
        const staffSettlementRows = staffSettlements ?? [];
        const staffSalesGross = sum(staffChargeRows, (r) => r.subtotal);
        const staffDiscount = sum(staffChargeRows, (r) => r.discount_amount);
        const staffCredit = sum(staffChargeRows, (r) => r.amount);
        const staffCollectedCash = sum(
          staffSettlementRows.filter((r: any) => r.method === "cash"),
          (r) => r.amount,
        );
        const staffCollectedQr = sum(
          staffSettlementRows.filter((r: any) => r.method === "qr"),
          (r) => r.amount,
        );
        const cashTipPayout = tipsByMethod("qr") + tipsByMethod("gov_qr") + tipsByMethod("card");
        const cashCounts = countedCashAfterOpening(shifts ?? []);
        const countedCashTotal = cashCounts == null
          ? null
          : sum(shifts ?? [], (shift) => totalCashCount(shift.cash_count) ?? 0);
        const openingFloatTotal =
          cashCounts == null
            ? null
            : sum(shifts ?? [], (shift) => shift.opening_float);
        const kbank = calculateKbankSettlement(
          date,
          previousQrPays ?? [],
          payRows.filter((payment: any) => payment.method === "qr"),
        );
        return json({
          date,
          has_data:
            billRows.length > 0 || staffChargeRows.length > 0 || staffSettlementRows.length > 0,
          bill_count: billRows.length,
          total_product_sales: sum(billRows, (b) => b.subtotal) + staffSalesGross,
          refund: refundTotal,
          // MB Discount = actual baht reductions, not the number of points spent.
          mb_discount:
            sum(billRows, (b) => b.member_discount_amount) +
            sum(billRows, (b) => b.loyalty_discount_amount),
          discount: sum(billRows, (b) => b.discount_amount) + staffDiscount,
          vat: sum(billRows, (b) => b.vat_amount),
          net_sales: sum(billRows, (b) => b.total) + staffCredit - refundTotal,
          // Sales tenders only. Staff-tab collections settle older receivables,
          // so expose them separately instead of inflating today's sales tender.
          // Keep the combined field for older Manager builds, and expose the
          // ordinary PromptPay amount explicitly so the UI never has to infer
          // it by subtracting 60/40.
          qr_total_amount: byMethod("qr") + byMethod("gov_qr"),
          qr_prompt_amount: byMethod("qr"),
          sixty_forty_amount: byMethod("gov_qr"),
          credit_amount: byMethod("card"),
          // Preserve what was actually received by each tender. Cash paid back
          // is reported separately in `refund`; it is not a payment-type edit.
          cash_amount: byMethod("cash"),
          staff_sales_gross: staffSalesGross,
          staff_discount: staffDiscount,
          staff_credit: staffCredit,
          staff_collected_cash: staffCollectedCash,
          staff_collected_qr: staffCollectedQr,
          cash_tip_payout: cashTipPayout,
          // Z-report drawer count less the opening float. Null means the day is
          // not fully closed or a shift has no denomination count yet.
          cash_counts: cashCounts,
          cash_counted_total: countedCashTotal,
          opening_float_total: openingFloatTotal,
          // Separate bank-settlement view. Daily sales stay on their business
          // day; KBANK Finance uses these cutoff totals for the deposit date.
          kbank_previous_after_cutoff: kbank.previousAfterCutoff,
          kbank_current_before_cutoff: kbank.currentBeforeCutoff,
          kbank_expected_deposit: kbank.expectedDeposit,
        });
      },
    },
  },
});
