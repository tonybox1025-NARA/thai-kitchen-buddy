import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const body = await req.json().catch(() => ({}));
  const requestId = String(body.requestId || crypto.randomUUID());
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await caller.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Unauthorized");

    const { data: prepared, error: prepareError } = await caller.rpc(
      "prepare_emergency_menu_price_change",
      {
        p_request_id: requestId,
        p_menu_id: body.menuId,
        p_new_price: Number(body.newPrice),
        p_reason: String(body.reason || ""),
        p_requested_by: body.requestedBy,
        p_manager_pin: String(body.managerPin || ""),
      },
    );
    if (prepareError) throw prepareError;
    const change = Array.isArray(prepared) ? prepared[0] : prepared;
    if (!change) throw new Error("Price change approval was not created");

    const managerUrl = "https://dpitentbotnbmoptgmap.supabase.co/functions/v1/apply-pos-emergency-price";
    // Reuse the existing bidirectional catalog bridge secret. It is already
    // configured in both projects and never leaves the server-side functions.
    const managerKey = Deno.env.get("POS_CATALOG_SYNC_SECRET");
    if (!managerKey) throw new Error("Manager price sync bridge is not configured");

    const managerResponse = await fetch(managerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Price-Sync-Key": managerKey },
      body: JSON.stringify({
        requestId,
        managerMenuId: change.manager_menu_id,
        posMenuId: body.menuId,
        oldPrice: Number(change.old_price),
        newPrice: Number(change.new_price),
        reason: String(body.reason || "").trim(),
        requestedBy: body.requestedBy,
        approvedBy: change.approved_by,
        approvedByName: change.approved_by_name,
      }),
    });
    const managerResult = await managerResponse.json().catch(() => ({}));
    if (!managerResponse.ok || managerResult.error) {
      throw new Error(managerResult.error || `Manager sync HTTP ${managerResponse.status}`);
    }

    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const serviceKey = secretKeys.default;
    if (!serviceKey) throw new Error("Missing POS database secret key");
    const apiKeyOnlyFetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.delete("Authorization");
      return fetch(input, { ...init, headers });
    };
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false }, global: { fetch: apiKeyOnlyFetch },
    });
    const { error: finishError } = await admin.rpc("finish_emergency_menu_price_change", {
      p_request_id: requestId, p_success: true, p_error_message: null,
    });
    if (finishError) throw finishError;

    return Response.json({
      ok: true, requestId, oldPrice: Number(change.old_price),
      newPrice: Number(change.new_price), approvedByName: change.approved_by_name,
    }, { headers: corsHeaders });
  } catch (error) {
    const errorMessage = messageOf(error);
    console.error("emergency-menu-price failed:", errorMessage);
    try {
      const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
      const serviceKey = secretKeys.default;
      if (serviceKey) {
        const url = Deno.env.get("SUPABASE_URL")!;
        const apiKeyOnlyFetch = (input: RequestInfo | URL, init?: RequestInit) => {
          const headers = new Headers(init?.headers); headers.delete("Authorization");
          return fetch(input, { ...init, headers });
        };
        const admin = createClient(url, serviceKey, {
          auth: { persistSession: false }, global: { fetch: apiKeyOnlyFetch },
        });
        await admin.rpc("finish_emergency_menu_price_change", {
          p_request_id: requestId, p_success: false, p_error_message: errorMessage,
        });
      }
    } catch (finishError) {
      console.error("Failed to record price sync failure:", messageOf(finishError));
    }
    return Response.json({ error: errorMessage, requestId }, { status: 400, headers: corsHeaders });
  }
});
