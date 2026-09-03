import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";

// Per-item sales for a business day, so the LONMOH Manager app can compute actual
// food cost (qty sold × recipe cost). Read-only aggregate over paid, non-test
// bills; voided line items excluded. Same key + CORS as daily-summary. Dormant
// until this POS goes live — returns has_data:false while sales run through MERI.
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

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });

type Agg = { menu_id: string | null; name_th: string; name_en: string; qty: number; revenue: number; cost: number };

export const Route = createFileRoute("/api/public/item-sales/$date")({
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

        const { data: shifts } = await sb.from("shifts").select("id").eq("business_day", date);
        const shiftIds = (shifts ?? []).map((s: any) => s.id);
        if (shiftIds.length === 0) return json({ date, has_data: false, item_count: 0, items: [] });

        const { data: bills } = await sb.from("bills")
          .select("order_id").in("shift_id", shiftIds).eq("status", "paid").not("is_test", "is", true);
        const orderIds = [...new Set((bills ?? []).map((b: any) => b.order_id).filter(Boolean))] as string[];
        if (orderIds.length === 0) return json({ date, has_data: false, item_count: 0, items: [] });

        const { data: items } = await sb.from("order_items")
          .select("menu_id,name_th,name_en,qty,unit_price,unit_cost")
          .in("order_id", orderIds).neq("status", "voided");

        const agg = new Map<string, Agg>();
        for (const it of (items ?? []) as any[]) {
          const qty = Number(it.qty) || 0;
          const key = it.menu_id ?? `__name__${it.name_th}`;
          let row = agg.get(key);
          if (!row) {
            row = { menu_id: it.menu_id ?? null, name_th: it.name_th, name_en: it.name_en, qty: 0, revenue: 0, cost: 0 };
            agg.set(key, row);
          }
          row.qty += qty;
          row.revenue += qty * (Number(it.unit_price) || 0);
          row.cost += qty * (Number(it.unit_cost) || 0);
        }

        const rows = [...agg.values()].sort((a, b) => b.qty - a.qty);
        return json({
          date,
          has_data: rows.length > 0,
          item_count: rows.length,
          total_qty: rows.reduce((s, r) => s + r.qty, 0),
          total_revenue: rows.reduce((s, r) => s + r.revenue, 0),
          total_cost: rows.reduce((s, r) => s + r.cost, 0),
          items: rows,
        });
      },
    },
  },
});
