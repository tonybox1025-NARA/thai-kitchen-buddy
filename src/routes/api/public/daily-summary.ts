import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";

// Daily sales summary for a business day, shaped to fill the LONMOH Manager app's
// Daily Sales Entry form. Read-only aggregate over paid, non-test bills. Guarded
// by a shared key so it isn't a wide-open sales feed (low-sensitivity, but gated).
const SYNC_KEY = "lm-sync-2f9a7c3e8b14";

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

const sum = (rows: any[], f: (r: any) => number) => rows.reduce((s, r) => s + (Number(f(r)) || 0), 0);

// Called cross-origin from the LONMOH Manager app, so allow CORS.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });

export const Route = createFileRoute("/api/public/daily-summary")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const supabase = createPublicServerClient();
        if (!supabase) return new Response("Unavailable", { status: 503, headers: CORS });

        const url = new URL(request.url);
        const date = url.searchParams.get("date"); // YYYY-MM-DD (business day)
        const key = url.searchParams.get("key");
        if (key !== SYNC_KEY) return json({ error: "Unauthorized" }, 401);
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Bad date" }, 400);

        const sb = supabase as any;

        // Shifts on this business day → their paid, non-test bills.
        const { data: shifts } = await sb.from("shifts").select("id").eq("business_day", date);
        const shiftIds = (shifts ?? []).map((s: any) => s.id);
        if (shiftIds.length === 0) {
          return json({ date, bill_count: 0, has_data: false });
        }

        const { data: bills } = await sb.from("bills")
          .select("id,subtotal,total,member_discount_amount,discount_amount,vat_amount")
          .in("shift_id", shiftIds).eq("status", "paid").not("is_test", "is", true);
        const billRows = bills ?? [];
        const billIds = billRows.map((b: any) => b.id);

        const [{ data: pays }, { data: refunds }] = await Promise.all([
          billIds.length
            ? sb.from("payments").select("method,amount").in("bill_id", billIds)
            : Promise.resolve({ data: [] }),
          sb.from("refunds").select("amount").in("shift_id", shiftIds),
        ]);
        const payRows = pays ?? [];
        const byMethod = (m: string) => sum(payRows.filter((p: any) => p.method === m), (p: any) => p.amount);

        return json({
          date,
          has_data: billRows.length > 0,
          bill_count: billRows.length,
          // Product sales (gross before discounts) + adjustments
          total_product_sales: sum(billRows, (b) => b.subtotal),
          refund: sum(refunds ?? [], (r) => r.amount),
          mb_discount: sum(billRows, (b) => b.member_discount_amount),
          discount: sum(billRows, (b) => b.discount_amount),
          vat: sum(billRows, (b) => b.vat_amount),
          net_sales: sum(billRows, (b) => b.total),
          // Payment methods
          qr_total_amount: byMethod("qr"),
          sixty_forty_amount: byMethod("gov_qr"),
          credit_amount: byMethod("card"),
          cash_amount: byMethod("cash"),
        });
      },
    },
  },
});
