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

        const { data: claim, error: claimErr } = await supabase
          .from("loyalty_claim_tokens")
          .select("id,token,bill_id,member_id,status,claim_points,total_amount,expires_at")
          .eq("token", params.token)
          .maybeSingle();
        if (claimErr) return Response.json({ error: claimErr.message }, { status: 500 });
        if (!claim) return Response.json({ error: "Claim not found" }, { status: 404 });

        if (claim.expires_at && new Date(claim.expires_at).getTime() < Date.now() && claim.status === "open") {
          await supabase.from("loyalty_claim_tokens").update({ status: "expired" }).eq("id", claim.id);
          return Response.json({ error: "Claim expired" }, { status: 410 });
        }

        let { data: member, error: memberErr } = await (supabase as any)
          .from("members")
          .select("id,full_name,current_points,member_group_en,guest_token")
          .eq("guest_token", guest_token)
          .maybeSingle();
        if (memberErr) return Response.json({ error: memberErr.message }, { status: 500 });

        if (!member) {
          const { data: created, error: createErr } = await (supabase as any)
            .from("members")
            .insert({
              full_name: "Guest Member",
              nickname: "Guest",
              guest_token,
              imported_from: "guest_wallet",
              member_group_en: "Guest Wallet",
              member_group_th: "Guest Wallet",
              opening_points: 0,
              current_points: 0,
            })
            .select("id,full_name,current_points,member_group_en,guest_token")
            .single();
          if (createErr) return Response.json({ error: createErr.message }, { status: 500 });
          member = created;
        }

        if (claim.status === "claimed") {
          const { data: linked } = await supabase
            .from("members")
            .select("id,full_name,current_points,member_group_en")
            .eq("id", claim.member_id ?? member.id)
            .maybeSingle();
          return Response.json({ status: "claimed", claim, member: linked ?? member });
        }

        if (claim.status !== "open") return Response.json({ error: "Claim is not available" }, { status: 409 });

        const points = Number(claim.claim_points ?? 0);
        const balanceAfter = Number(member.current_points ?? 0) + points;

        const { data: existingEarn } = await supabase
          .from("member_point_ledger")
          .select("id")
          .eq("bill_id", claim.bill_id)
          .eq("type", "earn")
          .maybeSingle();

        if (!existingEarn && points > 0) {
          const { error: updateErr } = await (supabase as any)
            .from("members")
            .update({ current_points: balanceAfter, updated_at: new Date().toISOString() })
            .eq("id", member.id);
          if (updateErr) return Response.json({ error: updateErr.message }, { status: 500 });

          const { error: ledgerErr } = await supabase.from("member_point_ledger").insert({
            member_id: member.id,
            bill_id: claim.bill_id,
            type: "earn",
            points,
            balance_after: balanceAfter,
            description: "Earned from receipt QR",
          });
          if (ledgerErr) return Response.json({ error: ledgerErr.message }, { status: 500 });
        }

        const { error: tokenErr } = await supabase
          .from("loyalty_claim_tokens")
          .update({
            member_id: member.id,
            status: "claimed",
            claimed_at: new Date().toISOString(),
          })
          .eq("id", claim.id);
        if (tokenErr) return Response.json({ error: tokenErr.message }, { status: 500 });

        return Response.json({
          status: "claimed",
          claim: { ...claim, status: "claimed", member_id: member.id },
          member: { ...member, current_points: existingEarn ? member.current_points : balanceAfter },
        });
      },
    },
  },
});
