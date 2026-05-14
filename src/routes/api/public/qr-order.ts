import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

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
        let body: unknown;
        try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
        const parsed = Schema.safeParse(body);
        if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
        const { table_code, guests, items } = parsed.data;

        const { data: table } = await supabaseAdmin
          .from("restaurant_tables").select("id,status,guests").eq("code", table_code).maybeSingle();
        if (!table) return new Response("Table not found", { status: 404 });

        // Validate menu items + fetch authoritative prices/names
        const menuIds = items.map((i) => i.menu_id);
        const { data: menus } = await supabaseAdmin
          .from("menus")
          .select("id,name_th,name_en,name_my,price,available")
          .in("id", menuIds);
        const menuMap = new Map((menus ?? []).map((m) => [m.id, m]));
        for (const it of items) {
          const m = menuMap.get(it.menu_id);
          if (!m || !m.available) return new Response(`Item unavailable: ${it.menu_id}`, { status: 400 });
        }

        // Find open shift (do not auto-open from public — staff opens shifts)
        const { data: shift } = await supabaseAdmin
          .from("shifts").select("id").eq("status", "open").maybeSingle();

        // Find or create an open order for this table (source=qr OR pos — reuse existing open table order)
        let { data: order } = await supabaseAdmin
          .from("orders").select("id").eq("table_id", table.id).eq("status", "open").maybeSingle();
        if (!order) {
          const { data: newOrder, error: orderErr } = await supabaseAdmin.from("orders").insert({
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
        const { error: itemsErr } = await supabaseAdmin.from("order_items").insert(rows);
        if (itemsErr) return new Response(itemsErr.message, { status: 500 });

        // Auto-send kitchen print job (same payload format as sendToKitchen in order.$orderId.tsx)
        const lines = rows.map((r) => ({ name_my: r.name_my, qty: r.qty, notes: r.notes }));
        await supabaseAdmin.from("print_jobs").insert({
          printer: "kitchen",
          payload: { table: table_code, lines, sent_at: sentAt, language: "my" },
        });

        // Mark table occupied + raise QR alert flag (the POS realtime listener will react)
        await supabaseAdmin.from("restaurant_tables").update({
          status: "occupied",
          guests: guests ?? Math.max(table.guests || 1, 1),
          has_qr_alert: true,
        }).eq("id", table.id);

        // Insert a synthetic 'qr' source marker order if table previously had a pos order — emit notification
        // (POS already listens to source=qr inserts on `orders`; emit a no-op event for existing reused orders)
        if (order) {
          await supabaseAdmin.from("orders").update({ source: "qr" }).eq("id", order.id).eq("source", "pos").select();
        }

        return Response.json({ ok: true, order_id: order.id, count: rows.length });
      },
    },
  },
});
