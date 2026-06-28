import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

function createPublicServerClient() {
  const url =
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL;
  // Service role bypasses RLS — required for server-side order writes.
  // Falls back to publishable key only if service role is absent (needs anon policies).
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) return null;

  return createClient<Database>(url, key, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

const Schema = z.object({
  table_code: z.string().min(1).max(20),
  guests: z.number().int().min(1).max(30).optional(),
  items: z
    .array(
      z.object({
        menu_id: z.string().uuid(),
        qty: z.number().int().min(1).max(50),
        notes: z.string().max(500).optional().nullable(),
        set_config: z.record(z.any()).optional().nullable(),
        addons: z.array(z.object({ option_id: z.string().uuid() })).optional().default([]),
      })
    )
    .min(1)
    .max(50),
});

export const Route = createFileRoute("/api/public/qr-order")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabase = createPublicServerClient();
        if (!supabase) return new Response("QR ordering is temporarily unavailable", { status: 503 });

        let body: unknown;
        try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
        const parsed = Schema.safeParse(body);
        if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
        const { table_code, guests, items } = parsed.data;

        const { data: table, error: tableErr } = await supabase
          .from("restaurant_tables").select("id,status,guests").eq("code", table_code).maybeSingle();
        if (tableErr) return new Response(`DB error: ${tableErr.message}`, { status: 500 });
        if (!table) return new Response("Table not found", { status: 404 });

        // Validate menu items + fetch authoritative prices/names
        const menuIds = items.map((i) => i.menu_id);
        const { data: menus } = await supabase
          .from("menus")
          .select("id,category_id,name_th,name_en,name_my,price,cost,available")
          .in("id", menuIds);
        const menuMap = new Map((menus ?? []).map((m) => [m.id, m]));
        for (const it of items) {
          const m = menuMap.get(it.menu_id);
          if (!m || !m.available) return new Response(`Item unavailable: ${it.menu_id}`, { status: 400 });
        }

        // Validate addon options + fetch authoritative prices/names
        const allOptionIds = items.flatMap((i) => i.addons ?? []).map((a) => a.option_id);
        type AddonOptionRow = { id: string; name: string; price: number; addon_group_id: string; addon_groups: { name: string; kitchen_name: string | null } | null };
        const optionMap = new Map<string, AddonOptionRow>();
        if (allOptionIds.length > 0) {
          const { data: options } = await (supabase as any)
            .from("addon_options")
            .select("id, name, price, addon_group_id, addon_groups(name, kitchen_name)")
            .in("id", allOptionIds);
          for (const opt of (options ?? []) as AddonOptionRow[]) {
            optionMap.set(opt.id, opt);
          }
        }

        // Auto-open a shift if none is open (uses configured starting cash)
        let { data: shift } = await supabase
          .from("shifts").select("id").eq("status", "open").maybeSingle();
        if (!shift) {
          const today = new Date().toISOString().slice(0, 10);
          const { data: cfg } = await supabase.from("settings").select("starting_cash").eq("id", 1).maybeSingle();
          const opening = Number((cfg as { starting_cash?: number } | null)?.starting_cash ?? 0);
          const { data: newShift } = await supabase.from("shifts")
            .insert({ business_day: today, opening_float: opening })
            .select("id").single();
          shift = newShift;
        }

        // Find or create an open order for this table (source=qr OR pos — reuse existing open table order)
        let { data: order } = await supabase
          .from("orders").select("id").eq("table_id", table.id).eq("status", "open").maybeSingle();
        if (!order) {
          const { data: newOrder, error: orderErr } = await supabase.from("orders").insert({
            table_id: table.id,
            guests: guests ?? Math.max(1, table.guests || 1),
            shift_id: shift?.id ?? null,
            source: "qr",
          }).select("id").single();
          if (orderErr || !newOrder) return new Response(orderErr?.message ?? "Failed to create order", { status: 500 });
          order = newOrder;
        }

        // Insert items as already-sent — kitchen gets the ticket automatically, no staff confirmation needed
        const sentAt = new Date().toISOString();
        const categoryIds = [...new Set((menus ?? []).map((m: any) => m.category_id).filter(Boolean))] as string[];
        const [{ data: categories }, { data: zones }] = await Promise.all([
          categoryIds.length
            ? supabase.from("categories").select("id,kitchen_zone_id").in("id", categoryIds)
            : Promise.resolve({ data: [] }),
          supabase.from("kitchen_zones").select("id,name_th,name_en,sort,active,print_to_kitchen").eq("active", true).order("sort"),
        ]);
        const categoryMap = new Map(((categories ?? []) as any[]).map((c) => [c.id, c]));
        const zoneMap = new Map(((zones ?? []) as any[]).map((z) => [z.id, z]));

        const rowEntries = items.map((it) => {
          const m = menuMap.get(it.menu_id)!;
          const sc = it.set_config as { main?: { th: string }; sides?: { th: string }[]; drink?: { th: string }; rice?: string } | null | undefined;
          const baseNotes = sc
            ? `หลัก: ${sc.main?.th ?? "—"} | ${(sc.sides ?? []).map((s) => s.th).join(", ")}${sc.drink ? ` | ${sc.drink.th}` : ""} | ${sc.rice === "porridge" ? "โจ๊ก" : "ข้าวสวย"}`
            : it.notes ?? null;

          // Build modifiers list from selected addon options
          const modifiers = (it.addons ?? []).map((a) => {
            const opt = optionMap.get(a.option_id);
            return {
              option_id: a.option_id,
              group_name: opt?.addon_groups?.kitchen_name ?? opt?.addon_groups?.name ?? "",
              option_name: opt?.name ?? "",
              price: opt?.price ?? 0,
            };
          });

          // Authoritative total: base price + sum of selected addon prices
          const addonTotal = modifiers.reduce((s, mod) => s + mod.price, 0);
          const unit_price = Number(m.price) + addonTotal;
          const category = (m as any).category_id ? categoryMap.get((m as any).category_id) : null;
          const zone = category?.kitchen_zone_id ? zoneMap.get(category.kitchen_zone_id) : null;

          return {
            zoneId: zone?.id ?? "__main__",
            zoneLabel: zone?.name_en ?? "Main Kitchen",
            printToKitchen: zone?.print_to_kitchen ?? true,
            row: {
              order_id: order!.id,
              menu_id: it.menu_id,
              name_th: m.name_th,
              name_en: m.name_en,
              name_my: m.name_my,
              qty: it.qty,
              unit_price,
              unit_cost: Number((m as any).cost ?? 0),
              notes: baseNotes,
              modifiers: modifiers.length > 0 ? modifiers : null,
              status: "sent" as const,
              sent_at: sentAt,
              set_config: it.set_config ?? null,
            },
          };
        });
        const rows = rowEntries.map((entry) => entry.row);
        const { error: itemsErr } = await (supabase as any).from("order_items").insert(rows);
        if (itemsErr) return new Response(itemsErr.message, { status: 500 });

        // Queue kitchen + counter print jobs (same format as sendToKitchen in order.$orderId.tsx)
        const lines = rowEntries.map((entry) => ({
          zoneId: entry.zoneId,
          zoneLabel: entry.zoneLabel,
          printToKitchen: entry.printToKitchen,
          name_th: entry.row.name_th,
          name_en: entry.row.name_en,
          name_my: entry.row.name_my,
          qty: entry.row.qty,
          notes: entry.row.notes,
          modifiers: (entry.row.modifiers as { option_name: string; price: number }[] | null),
        }));
        const counterLines = lines.map(({ zoneId: _zoneId, zoneLabel: _zoneLabel, printToKitchen: _printToKitchen, ...line }) => line);
        const ticketPayload = { kind: "order_ticket", table: table_code, source: "qr", lines: counterLines, sent_at: sentAt };
        const grouped = new Map<string, { zoneLabel: string; lines: typeof counterLines }>();
        for (const line of lines) {
          if (!line.printToKitchen) continue;
          const entry = grouped.get(line.zoneId) ?? { zoneLabel: line.zoneLabel, lines: [] };
          const { zoneId: _zoneId, zoneLabel: _zoneLabel, printToKitchen: _printToKitchen, ...ticketLine } = line;
          entry.lines.push(ticketLine);
          grouped.set(line.zoneId, entry);
        }
        await supabase.from("print_jobs").insert([
          ...[...grouped.values()].map((group, index, all) => ({
            printer: "kitchen" as const,
            payload: {
              ...ticketPayload,
              lines: group.lines,
              language: "my",
              department: group.zoneLabel,
              station: group.zoneLabel,
              ticketIndex: index + 1,
              ticketTotal: all.length,
            },
          })),
          { printer: "counter", payload: { ...ticketPayload, language: "th" } },
        ]);

        // Mark table occupied + raise QR alert flag (the POS realtime listener will react)
        await supabase.from("restaurant_tables").update({
          status: "occupied",
          guests: guests ?? Math.max(table.guests || 1, 1),
          has_qr_alert: true,
        }).eq("id", table.id);

        // Insert a synthetic 'qr' source marker order if table previously had a pos order — emit notification
        // (POS already listens to source=qr inserts on `orders`; emit a no-op event for existing reused orders)
        if (order) {
          await supabase.from("orders").update({ source: "qr" }).eq("id", order.id).eq("source", "pos").select();
        }

        return Response.json({ ok: true, order_id: order.id, count: rows.length });
      },
    },
  },
});
