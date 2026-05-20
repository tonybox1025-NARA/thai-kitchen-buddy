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
        notes: z.string().max(200).optional().nullable(),
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
          .select("id,name_th,name_en,name_my,price,available")
          .in("id", menuIds);
        const menuMap = new Map((menus ?? []).map((m) => [m.id, m]));
        for (const it of items) {
          const m = menuMap.get(it.menu_id);
          if (!m || !m.available) return new Response(`Item unavailable: ${it.menu_id}`, { status: 400 });
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
        const rows = items.map((it) => {
          const m = menuMap.get(it.menu_id)!;
          return {
            order_id: order!.id,
            menu_id: it.menu_id,
            name_th: m.name_th,
            name_en: m.name_en,
            name_my: m.name_my,
            qty: it.qty,
            unit_price: m.price,
            notes: it.notes ?? null,
            status: "sent" as const,
            sent_at: sentAt,
          };
        });
        const { error: itemsErr } = await supabase.from("order_items").insert(rows);
        if (itemsErr) return new Response(itemsErr.message, { status: 500 });

        // Queue kitchen + counter print jobs (same format as sendToKitchen in order.$orderId.tsx)
        const lines = rows.map((r) => ({
          name_th: r.name_th,
          name_en: r.name_en,
          name_my: r.name_my,
          qty: r.qty,
          notes: r.notes,
        }));
        const ticketPayload = { kind: "order_ticket", table: table_code, source: "qr", lines, sent_at: sentAt };
        await supabase.from("print_jobs").insert([
          { printer: "kitchen", payload: { ...ticketPayload, language: "my" } },
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
