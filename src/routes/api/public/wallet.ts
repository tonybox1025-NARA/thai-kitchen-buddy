import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

// Same service-role/publishable server client the loyalty-claim endpoint uses.
function createPublicServerClient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

const MEMBER_COLS = "id,full_name,nickname,current_points,member_level,member_group_en,birthday,phone,created_at,line_user_id";

const Body = z.object({
  guest_token: z.string().min(20).max(120),
  // Optional progressive-profile update — the customer can add a name/birthday
  // later to unlock birthday perks, but nothing is ever required to have a wallet.
  profile: z
    .object({
      full_name: z.string().trim().max(80).optional(),
      nickname: z.string().trim().max(40).optional(),
      birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").optional(),
    })
    .optional(),
});

export const Route = createFileRoute("/api/public/wallet")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabase = createPublicServerClient();
        if (!supabase) return new Response("Wallet is temporarily unavailable", { status: 503 });

        let raw: unknown;
        try { raw = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
        const parsed = Body.safeParse(raw);
        if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
        const { guest_token, profile } = parsed.data;

        // Find the wallet for this device, or create an anonymous guest member.
        let { data: member, error: findErr } = await (supabase as any)
          .from("members")
          .select(MEMBER_COLS)
          .eq("guest_token", guest_token)
          .maybeSingle();
        if (findErr) return Response.json({ error: findErr.message }, { status: 500 });

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
            .select(MEMBER_COLS)
            .single();
          if (createErr) return Response.json({ error: createErr.message }, { status: 500 });
          member = created;
        }

        // Optional profile update (only the fields the customer actually provided).
        if (profile && (profile.full_name || profile.nickname || profile.birthday)) {
          const patch: Record<string, string> = {};
          if (profile.full_name) patch.full_name = profile.full_name;
          if (profile.nickname) patch.nickname = profile.nickname;
          if (profile.birthday) patch.birthday = profile.birthday;
          const { data: updated, error: updErr } = await (supabase as any)
            .from("members")
            .update({ ...patch, updated_at: new Date().toISOString() })
            .eq("id", member.id)
            .select(MEMBER_COLS)
            .single();
          if (updErr) return Response.json({ error: updErr.message }, { status: 500 });
          member = updated;
        }

        const { data: history } = await supabase
          .from("member_point_ledger")
          .select("id,type,points,balance_after,description,created_at")
          .eq("member_id", member.id)
          .order("created_at", { ascending: false })
          .limit(20);

        return Response.json({ member, history: history ?? [] });
      },
    },
  },
});
