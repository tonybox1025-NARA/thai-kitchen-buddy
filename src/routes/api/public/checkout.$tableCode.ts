/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

function client() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Public table devices can only ask staff to bring the bill. Member lookup,
// registration, rewards and every payment action belong to the SUNMI checkout.
const Body = z.object({ action: z.literal("request_bill") });

async function tableOrder(sb: ReturnType<typeof client>, tableCode: string, orderId?: string | null) {
  if (!sb) return null;
  if (orderId) {
    const { data: order } = await (sb as any).from("orders")
      .select("id,shift_id,checkout_requested_at,table_id")
      .eq("id", orderId).eq("status", "open").maybeSingle();
    if (!order?.table_id) return null;
    const { data: table } = await sb.from("restaurant_tables")
      .select("id,code,status").eq("id", order.table_id).maybeSingle();
    return table ? { table, order } : null;
  }
  const { data: table } = await sb
    .from("restaurant_tables")
    .select("id,code,status")
    .eq("code", tableCode)
    .maybeSingle();
  if (!table) return null;
  const { data: rows } = await (sb as any)
    .from("orders")
    .select("id,shift_id,checkout_requested_at")
    .eq("table_id", table.id)
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1);
  return { table, order: rows?.[0] ?? null };
}

async function ensureBill(
  sb: NonNullable<ReturnType<typeof client>>,
  order: { id: string; shift_id: string | null },
) {
  let { data: bill } = await sb.from("bills").select("*").eq("order_id", order.id).maybeSingle();
  const { data: items } = await sb
    .from("order_items")
    .select("qty,unit_price,status")
    .eq("order_id", order.id)
    .neq("status", "voided");
  const subtotal = (items ?? []).reduce(
    (sum, item) => sum + Number(item.qty) * Number(item.unit_price),
    0,
  );
  if (!bill) {
    const { data: billId, error: billError } = await (sb as any).rpc("get_or_create_bill", { p_order_id: order.id });
    if (billError) throw billError;
    const existing = await sb.from("bills").select("*").eq("id", billId).single();
    if (existing.error) throw existing.error;
    bill = existing.data;
  } else if (Number(bill.subtotal) !== subtotal) {
    const discount = Number((bill as any).loyalty_discount_amount ?? 0);
    const updated = await sb
      .from("bills")
      .update({ subtotal, total: Math.max(0, subtotal - discount) })
      .eq("id", bill.id)
      .select("*")
      .single();
    if (updated.error) throw updated.error;
    bill = updated.data;
  }
  return bill;
}

export const Route = createFileRoute("/api/public/checkout/$tableCode")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const sb = client();
        if (!sb) return new Response("Checkout is temporarily unavailable", { status: 503 });
        const found = await tableOrder(sb, params.tableCode, new URL(request.url).searchParams.get("order_id"));
        if (!found?.order) return Response.json({ order: null });
        const bill = await ensureBill(sb, found.order);
        return Response.json({
          order: { id: found.order.id, checkout_requested_at: found.order.checkout_requested_at },
          bill: {
            id: bill.id,
            subtotal: Number(bill.subtotal),
            total: Number(bill.total),
          },
        });
      },

      POST: async ({ request, params }) => {
        const sb = client();
        if (!sb) return new Response("Checkout is temporarily unavailable", { status: 503 });
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = Body.safeParse(raw);
        if (!parsed.success) {
          return Response.json(
            { error: "Member, loyalty and payment actions are available only at the SUNMI POS" },
            { status: 403 },
          );
        }
        const found = await tableOrder(sb, params.tableCode, new URL(request.url).searchParams.get("order_id"));
        if (!found?.order) return Response.json({ error: "No open order" }, { status: 404 });
        const bill = await ensureBill(sb, found.order);
        const now = new Date().toISOString();
        await (sb as any)
          .from("orders")
          .update({ checkout_requested_at: now })
          .eq("id", found.order.id);
        await sb
          .from("restaurant_tables")
          .update({ status: "bill_requested" })
          .eq("id", found.table.id);
        return Response.json({ ok: true, bill_id: bill.id, requested_at: now });
      },
    },
  },
});
