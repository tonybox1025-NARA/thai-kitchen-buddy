import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MANAGER_AUTH_URL = "https://dpitentbotnbmoptgmap.supabase.co/functions/v1/shared-pin-auth";
const INTERNAL_DEVICE_EMAIL = "pos-device-access@lonmoh.internal";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const adminClient = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const bridge = async (body: Record<string, unknown>) => {
  const secret = Deno.env.get("POS_CATALOG_SYNC_SECRET");
  if (!secret) throw new Error("Shared app access bridge is not configured");
  const response = await fetch(MANAGER_AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-App-Access-Key": secret,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const error = new Error(payload.error || `Manager access bridge HTTP ${response.status}`);
    (error as { status?: number }).status = response.status;
    throw error;
  }
  return payload as { configured?: boolean; version: number; ok?: boolean };
};

const activeStaff = async (admin: ReturnType<typeof adminClient>) => {
  const { data, error } = await admin
    .from("staff")
    .select("id,name,role,position")
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    position: row.position,
  }));
};

const findOrCreateDeviceUser = async (admin: ReturnType<typeof adminClient>) => {
  const { data: page, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listError) throw listError;
  const existing = page.users.find((user) => user.email?.toLowerCase() === INTERNAL_DEVICE_EMAIL);
  if (existing) return existing;
  const randomPassword = `${crypto.randomUUID()}A9!${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email: INTERNAL_DEVICE_EMAIL,
    password: randomPassword,
    email_confirm: true,
    user_metadata: { purpose: "shared-pos-device-access" },
  });
  if (error) throw error;
  return data.user;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "status");
    const admin = adminClient();

    if (action === "status") {
      const state = await bridge({ action: "bridge_status" });
      return json({
        configured: Boolean(state.configured),
        version: Number(state.version),
        profiles: state.configured ? await activeStaff(admin) : [],
      });
    }

    if (action === "login") {
      const pin = String(body.pin || "");
      const staffId = String(body.profile_id || "");
      const deviceId = String(body.device_id || "");
      if (!deviceId || !staffId || !/^\d{6}$/.test(pin))
        return json({ error: "Name and 6-digit PIN are required" }, 400);
      const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const state = await bridge({
        action: "bridge_verify",
        pin,
        device_id: deviceId,
        client_ip: clientIp,
      });
      const profiles = await activeStaff(admin);
      const profile = profiles.find((candidate) => candidate.id === staffId);
      if (!profile) return json({ error: "This staff profile is not available" }, 403);
      const deviceUser = await findOrCreateDeviceUser(admin);
      if (!deviceUser.email) throw new Error("POS device account email is missing");
      const { data: link, error: linkError } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: deviceUser.email,
      });
      if (linkError) throw linkError;
      return json({
        token_hash: link.properties.hashed_token,
        type: "magiclink",
        version: Number(state.version),
        profile,
      });
    }

    return json({ error: "Invalid action" }, 400);
  } catch (error) {
    console.error("shared-pin-auth failed", error);
    const status = Number((error as { status?: number })?.status || 500);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, status);
  }
});
