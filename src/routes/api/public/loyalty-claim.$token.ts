import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

function createPublicServerClient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
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

const Body = z.object({
  guest_token: z.string().min(20).max(120),
});

export const Route = createFileRoute("/api/public/loyalty-claim/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const supabase = createPublicServerClient();
        if (!supabase) return new Response("Loyalty is temporarily unavailable", { status: 503 });

        const { data: claim, error } = await supabase
          .from("loyalty_claim_tokens")
          .select("token,status,claim_points,total_amount,claimed_at,expires_at,member_id")
          .eq("token", params.token)
          .maybeSingle();
        if (error) return Response.json({ error: error.message }, { status: 500 });
        if (!claim) return Response.json({ error: "Claim not found" }, { status: 404 });

        let member = null;
        if (claim.member_id) {
          const { data } = await supabase
            .from("members")
            .select("id,full_name,current_points,member_group_en")
            .eq("id", claim.member_id)
            .maybeSingle();
          member = data;
        }

        return Response.json({ claim, member });
      },

      POST: async ({ request, params }) => {
        const supabase = createPublicServerClient();
        if (!supabase) return new Response("Loyalty is temporarily unavailable", { status: 503 });

        let raw: unknown;
        try { raw = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
        const parsed = Body.safeParse(raw);
        if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
        const { guest_token } = parsed.data;

        const { data, error } = await (supabase as any).rpc("claim_receipt_loyalty_points", {
          p_claim_token: params.token,
          p_guest_token: guest_token,
        });
        if (error) {
          const status = error.message.includes("not found") ? 404
            : error.message.includes("expired") ? 410
            : error.message.includes("not available") ? 409
            : 500;
          return Response.json({ error: error.message }, { status });
        }

        const result = Array.isArray(data) ? data[0] : data;
        return Response.json({
          status: result.claim_status,
          claim: { token: params.token, status: result.claim_status, member_id: result.member_id },
          member: {
            id: result.member_id,
            full_name: result.member_name,
            current_points: result.current_points,
            member_group_en: result.member_group_en,
          },
        });
      },
    },
  },
});
