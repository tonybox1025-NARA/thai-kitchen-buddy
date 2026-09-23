import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Missing authorization" }, 401);
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authorization } } },
  );
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return json({ error: "Unauthorized" }, 401);

  const sharedSecret = Deno.env.get("POS_CATALOG_SYNC_SECRET")?.trim();
  if (!sharedSecret) return json({ error: "POS_CATALOG_SYNC_SECRET is not configured" }, 500);

  const response = await fetch(
    "https://dpitentbotnbmoptgmap.supabase.co/functions/v1/attendance-live-summary",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-pos-sync-secret": sharedSecret },
      body: "{}",
    },
  );
  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
