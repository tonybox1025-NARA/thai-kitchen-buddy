import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const managerUrl = "https://dpitentbotnbmoptgmap.supabase.co/functions/v1/import-pos-daily-close";
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
const messageOf = (e: unknown) => e instanceof Error ? e.message : String(e);
const sum = (rows: any[], field: string) => rows.reduce((n, r) => n + Number(r[field] || 0), 0);

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  let shiftId = "";
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) throw new Error("Missing authorization");
    const body = await req.json();
    shiftId = String(body.shiftId || "");
    if (!shiftId) throw new Error("Shift ID required");

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const caller = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const token = auth.replace(/^Bearer\s+/i, "");
    const { data: who } = await caller.auth.getUser(token);
    if (!who.user) throw new Error("Unauthorized");

    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    if (!secretKeys.default) throw new Error("Missing POS database secret key");
    const db = createClient(url, secretKeys.default, { auth: { persistSession: false } });
    const { data: shift, error: shiftError } = await db.from("shifts").select("id,business_day,status,totals").eq("id", shiftId).single();
    if (shiftError || !shift) throw shiftError || new Error("Shift not found");
    if (shift.status !== "closed") throw new Error("Only a closed shift can be synced");

    await db.from("daily_close_sync_outbox").upsert({ shift_id: shift.id, business_day: shift.business_day }, { onConflict: "shift_id", ignoreDuplicates: true });
    if (Deno.env.get("MANAGER_DAILY_SYNC_ENABLED") !== "true") {
      await db.from("daily_close_sync_outbox").update({ status: "disabled", updated_at: new Date().toISOString() }).eq("shift_id", shift.id);
      return json({ ok: true, enabled: false, status: "prepared_not_connected" });
    }

    const { data: bills, error: billsError } = await db.from("bills")
      .select("id,order_id,subtotal,total,member_discount_amount,loyalty_discount_amount,discount_amount,vat_amount")
      .eq("shift_id", shift.id).eq("status", "paid").not("is_test", "is", true);
    if (billsError) throw billsError;
    const billIds = (bills || []).map((b: any) => b.id);
    const orderIds = [...new Set((bills || []).map((b: any) => b.order_id).filter(Boolean))];
    const [{ data: payments, error: paymentError }, { data: refunds, error: refundError }, { data: orderItems, error: itemError }] = await Promise.all([
      billIds.length ? db.from("payments").select("method,amount").in("bill_id", billIds) : Promise.resolve({ data: [], error: null }),
      db.from("refunds").select("amount").eq("shift_id", shift.id),
      orderIds.length ? db.from("order_items").select("menu_id,name_th,name_en,qty,unit_price").in("order_id", orderIds).neq("status", "voided") : Promise.resolve({ data: [], error: null }),
    ]);
    if (paymentError || refundError || itemError) throw paymentError || refundError || itemError;
    const byMethod = (method: string) => (payments || []).filter((p: any) => p.method === method).reduce((n: number, p: any) => n + Number(p.amount || 0), 0);
    const itemMap = new Map<string, any>();
    for (const item of orderItems || []) {
      const key = item.menu_id || `name:${item.name_th}`;
      const row = itemMap.get(key) || { menu_id: item.menu_id, name_th: item.name_th, name_en: item.name_en, qty: 0, revenue: 0 };
      row.qty += Number(item.qty || 0); row.revenue += Number(item.qty || 0) * Number(item.unit_price || 0); itemMap.set(key, row);
    }
    const items = [...itemMap.values()].sort((a, b) => String(a.menu_id || a.name_th).localeCompare(String(b.menu_id || b.name_th)));
    const cashSummary = (shift.totals || {}) as any;
    const promptPayAmount = byMethod("qr");
    const sixtyFortyAmount = byMethod("gov_qr");
    const summary = {
      total_product_sales: sum(bills || [], "subtotal"), refund: sum(refunds || [], "amount"),
      mb_discount: sum(bills || [], "member_discount_amount") + sum(bills || [], "loyalty_discount_amount"),
      discount: sum(bills || [], "discount_amount"), vat: sum(bills || [], "vat_amount"), net_sales: sum(bills || [], "total"),
      // Manager historically stores QR Total as the combined QR bucket and
      // derives PromptPay by subtracting 60/40. Preserve that meaning while
      // also transmitting the explicit POS figures for reconciliation.
      qr_total_amount: promptPayAmount + sixtyFortyAmount,
      qr_prompt_amount: promptPayAmount,
      sixty_forty_amount: sixtyFortyAmount,
      credit_amount: byMethod("card"), cash_amount: byMethod("cash"),
      cash_count: Number(cashSummary.cashTotal || 0), cash_over_short: Number(cashSummary.overShort || 0),
      item_revenue: items.reduce((n, i) => n + i.revenue, 0), bill_count: (bills || []).length,
    };
    const canonical = { shiftId: shift.id, businessDay: shift.business_day, summary, items };
    const payloadHash = await sha256(canonical);
    await db.from("daily_close_sync_outbox").update({ status: "sending", attempts: (Number((await db.from("daily_close_sync_outbox").select("attempts").eq("shift_id",shift.id).single()).data?.attempts || 0) + 1), last_attempt_at: new Date().toISOString(), payload_hash: payloadHash, last_error: null, updated_at: new Date().toISOString() }).eq("shift_id", shift.id);
    const bridgeKey = Deno.env.get("POS_CATALOG_SYNC_SECRET");
    if (!bridgeKey) throw new Error("Manager sync bridge secret missing");
    const response = await fetch(managerUrl, { method: "POST", headers: { "Content-Type": "application/json", "X-POS-Sync-Key": bridgeKey }, body: JSON.stringify({ ...canonical, payloadHash }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.error) throw new Error(result.error || `Manager HTTP ${response.status}`);
    await db.from("daily_close_sync_outbox").update({ status: "sent", synced_at: new Date().toISOString(), manager_result: result, last_error: null, updated_at: new Date().toISOString() }).eq("shift_id", shift.id);
    return json({ ok: true, enabled: true, status: "sent", result });
  } catch (e) {
    const message = messageOf(e); console.error("sync-daily-close failed", message);
    try {
      if (shiftId) {
        const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
        if (keys.default) await createClient(Deno.env.get("SUPABASE_URL")!, keys.default).from("daily_close_sync_outbox").update({ status: "failed", last_error: message, updated_at: new Date().toISOString() }).eq("shift_id", shiftId);
      }
    } catch { /* preserve original error */ }
    return json({ error: message }, 400);
  }
});
