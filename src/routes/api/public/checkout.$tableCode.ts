/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

const REWARD_TIERS = [
  { points: 500, baht: 25 },
  { points: 1000, baht: 50 },
  { points: 2000, baht: 100 },
  { points: 5000, baht: 300 },
  { points: 10000, baht: 600 },
  { points: 15000, baht: 1000 },
] as const;

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

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request_bill") }),
  z.object({
    action: z.literal("reserve_reward"),
    guest_token: z.string().min(20).max(120),
    points: z.number().int().min(0),
  }),
]);

async function tableOrder(sb: ReturnType<typeof client>, tableCode: string) {
  if (!sb) return null;
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
    const { data: settings } = await sb
      .from("settings")
      .select("vat_mode,vat_rate")
      .eq("id", 1)
      .maybeSingle();
    const created = await sb
      .from("bills")
      .insert({
        order_id: order.id,
        shift_id: order.shift_id,
        subtotal,
        total: subtotal,
        vat_mode: settings?.vat_mode ?? "inclusive",
        vat_rate: settings?.vat_rate ?? 7,
      })
      .select("*")
      .single();
    if (created.error) throw created.error;
    bill = created.data;
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
        const found = await tableOrder(sb, params.tableCode);
        if (!found?.order) return Response.json({ order: null, rewards: REWARD_TIERS });
        const bill = await ensureBill(sb, found.order);
        const guestToken = new URL(request.url).searchParams.get("guest_token");
        let member = null;
        if (guestToken && guestToken.length >= 20) {
          const result = await (sb as any)
            .from("members")
            .select("id,full_name,nickname,current_points")
            .eq("guest_token", guestToken)
            .eq("status", "active")
            .maybeSingle();
          member = result.data ?? null;
        }
        return Response.json({
          order: { id: found.order.id, checkout_requested_at: found.order.checkout_requested_at },
          bill: {
            id: bill.id,
            subtotal: Number(bill.subtotal),
            points: Number((bill as any).points_redeemed ?? 0),
            discount: Number((bill as any).loyalty_discount_amount ?? 0),
            total: Math.max(
              0,
              Number(bill.subtotal) - Number((bill as any).loyalty_discount_amount ?? 0),
            ),
            member_id: (bill as any).member_id ?? null,
          },
          member,
          rewards: REWARD_TIERS,
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
        if (!parsed.success)
          return Response.json({ error: parsed.error.flatten() }, { status: 400 });
        const found = await tableOrder(sb, params.tableCode);
        if (!found?.order) return Response.json({ error: "No open order" }, { status: 404 });
        const bill = await ensureBill(sb, found.order);

        if (parsed.data.action === "request_bill") {
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
        }

        const { data, error } = await (sb as any).rpc("reserve_customer_bill_loyalty", {
          p_bill_id: bill.id,
          p_guest_token: parsed.data.guest_token,
          p_redeem_points: parsed.data.points,
        });
        if (error)
          return Response.json(
            { error: error.message },
            { status: error.message.includes("Insufficient") ? 409 : 400 },
          );
        const result = Array.isArray(data) ? data[0] : data;
        return Response.json({
          ok: true,
          reservation: result,
          total: Math.max(0, Number(bill.subtotal) - Number(result.discount_amount)),
        });
      },
    },
  },
});
