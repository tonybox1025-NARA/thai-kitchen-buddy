import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";
import { bangkokDayUtcBounds } from "@/lib/business-day";

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
type SetComponentAgg = {
  parent_menu_id: string | null;
  parent_name_th: string;
  parent_name_en: string;
  menu_id: string | null;
  group: "main" | "side" | "rice" | "drink";
  name_th: string;
  name_en: string;
  qty: number;
};

type StoredSetItem = { id?: string | null; th?: string | null; en?: string | null };
type StoredSetConfig = {
  main?: StoredSetItem | null;
  sides?: StoredSetItem[] | null;
  drink?: StoredSetItem | null;
  rice?: "rice" | "porridge" | null;
};

function addSetComponent(
  map: Map<string, SetComponentAgg>,
  parent: { menu_id?: string | null; name_th?: string | null; name_en?: string | null; qty?: number | null },
  group: SetComponentAgg["group"],
  component: StoredSetItem,
) {
  const qty = Number(parent.qty) || 0;
  if (qty <= 0) return;
  const menuId = component.id || null;
  const nameTh = String(component.th || component.en || "").trim();
  const nameEn = String(component.en || component.th || "").trim();
  if (!nameTh && !nameEn) return;
  const key = [parent.menu_id || parent.name_en || parent.name_th, group, menuId || nameTh].join("::");
  const current = map.get(key);
  if (current) {
    current.qty += qty;
    return;
  }
  map.set(key, {
    parent_menu_id: parent.menu_id || null,
    parent_name_th: String(parent.name_th || parent.name_en || ""),
    parent_name_en: String(parent.name_en || parent.name_th || ""),
    menu_id: menuId,
    group,
    name_th: nameTh,
    name_en: nameEn,
    qty,
  });
}

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

        const [openedFrom, openedBefore] = bangkokDayUtcBounds(date);
        const { data: shifts } = await sb.from("shifts").select("id")
          .gte("opened_at", openedFrom).lt("opened_at", openedBefore);
        const shiftIds = (shifts ?? []).map((s: any) => s.id);
        if (shiftIds.length === 0) return json({ date, has_data: false, item_count: 0, items: [] });

        const [{ data: bills }, { data: staffCharges }] = await Promise.all([
          sb.from("bills").select("order_id").in("shift_id", shiftIds).in("status", ["paid", "partial_refund", "refunded"]).not("is_test", "is", true),
          sb.from("staff_tab_charges").select("order_id").in("shift_id", shiftIds).neq("status", "voided"),
        ]);
        const staffOrderIds = new Set((staffCharges ?? []).map((charge: any) => charge.order_id).filter(Boolean));
        const orderIds = [...new Set([
          ...(bills ?? []).map((bill: any) => bill.order_id),
          ...staffOrderIds,
        ].filter(Boolean))] as string[];
        if (orderIds.length === 0) return json({ date, has_data: false, item_count: 0, items: [] });

        const { data: items } = await sb.from("order_items")
          .select("order_id,menu_id,name_th,name_en,qty,unit_price,unit_cost,set_config")
          .in("order_id", orderIds).neq("status", "voided");

        const agg = new Map<string, Agg>();
        const setComponents = new Map<string, SetComponentAgg>();
        for (const it of (items ?? []) as any[]) {
          const qty = Number(it.qty) || 0;
          const key = it.menu_id ?? `__name__${it.name_th}`;
          let row = agg.get(key);
          if (!row) {
            row = { menu_id: it.menu_id ?? null, name_th: it.name_th, name_en: it.name_en, qty: 0, revenue: 0, cost: 0 };
            agg.set(key, row);
          }
          row.qty += qty;
          // Staff-tab items are discounted sales recognized on the consumption
          // day. Keep their menu-price revenue here so Item Sales reconciles to
          // Daily Sales gross; the staff discount is reported separately there.
          row.revenue += qty * (Number(it.unit_price) || 0);
          row.cost += qty * (Number(it.unit_cost) || 0);

          const setConfig = it.set_config as StoredSetConfig | null | undefined;
          if (setConfig?.main) addSetComponent(setComponents, it, "main", setConfig.main);
          for (const side of setConfig?.sides ?? []) addSetComponent(setComponents, it, "side", side);
          if (setConfig?.drink) addSetComponent(setComponents, it, "drink", setConfig.drink);
          if (setConfig?.rice === "rice") {
            addSetComponent(setComponents, it, "rice", { th: "ข้าวสวย", en: "Steamed Rice" });
          } else if (setConfig?.rice === "porridge") {
            addSetComponent(setComponents, it, "rice", { th: "ข้าวต้ม", en: "Rice Porridge" });
          }
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
          // Component rows carry no extra revenue. Manager uses them only to
          // deduct the exact recipes selected inside each sold SET.
          set_components: [...setComponents.values()],
        });
      },
    },
  },
});
