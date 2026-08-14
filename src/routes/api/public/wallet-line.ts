import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

// Links a device wallet (guest_token) to the customer's LINE identity.
// The client sends a LIFF ID token; we verify it with LINE (no secret needed —
// client_id is the public channel id) so a caller can't spoof someone else's
// LINE user id. Then we either claim this guest wallet with the LINE identity,
// or merge this device into the member that already owns that LINE id.
const LINE_CHANNEL_ID = "2011108366";
const MEMBER_COLS = "id,full_name,nickname,current_points,member_level,member_group_en,birthday,phone,created_at,line_user_id";

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

const Body = z.object({
  guest_token: z.string().min(20).max(120),
  id_token: z.string().min(20).max(4000),
});

export const Route = createFileRoute("/api/public/wallet-line")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabase = createPublicServerClient();
        if (!supabase) return new Response("Wallet is temporarily unavailable", { status: 503 });

        let raw: unknown;
        try { raw = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
        const parsed = Body.safeParse(raw);
        if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
        const { guest_token, id_token } = parsed.data;

        // Verify the LINE ID token → trusted userId (sub) + display name.
        const verifyRes = await fetch("https://api.line.me/oauth2/v2.1/verify", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ id_token, client_id: LINE_CHANNEL_ID }),
        });
        const claims: any = await verifyRes.json().catch(() => null);
        if (!verifyRes.ok || !claims?.sub) {
          return Response.json({ error: claims?.error_description ?? "LINE verification failed" }, { status: 401 });
        }
        const lineUserId: string = claims.sub;
        const lineName: string | null = claims.name ?? null;

        const sb = supabase as any;

        // Current device wallet (create a guest if this device is brand new).
        let { data: current } = await sb.from("members").select(MEMBER_COLS).eq("guest_token", guest_token).maybeSingle();
        if (!current) {
          const { data: created, error: createErr } = await sb.from("members").insert({
            full_name: lineName || "Guest Member", nickname: "Guest", guest_token,
            imported_from: "guest_wallet", member_group_en: "Guest Wallet", member_group_th: "Guest Wallet",
            opening_points: 0, current_points: 0,
          }).select(MEMBER_COLS).single();
          if (createErr) return Response.json({ error: createErr.message }, { status: 500 });
          current = created;
        }

        // Does another member already own this LINE identity?
        const { data: existing } = await sb.from("members").select(MEMBER_COLS).eq("line_user_id", lineUserId).maybeSingle();

        let member = current;
        if (existing && existing.id !== current.id) {
          // Merge this device into the existing LINE-linked member: move points +
          // ledger, point this device's token at it, remove the duplicate guest.
          await sb.from("member_point_ledger").update({ member_id: existing.id }).eq("member_id", current.id);
          const mergedPoints = Number(existing.current_points ?? 0) + Number(current.current_points ?? 0);
          const { data: upd } = await sb.from("members")
            .update({ current_points: mergedPoints, guest_token, updated_at: new Date().toISOString() })
            .eq("id", existing.id).select(MEMBER_COLS).single();
          await sb.from("members").delete().eq("id", current.id);
          member = upd ?? existing;
        } else {
          // First link: claim this guest wallet with the LINE identity.
          const patch: Record<string, any> = { line_user_id: lineUserId, updated_at: new Date().toISOString() };
          if (!current.full_name || current.full_name === "Guest Member") patch.full_name = lineName || current.full_name;
          const { data: upd, error: updErr } = await sb.from("members").update(patch).eq("id", current.id).select(MEMBER_COLS).single();
          if (updErr) return Response.json({ error: updErr.message }, { status: 500 });
          member = upd;
        }

        const { data: history } = await sb.from("member_point_ledger")
          .select("id,type,points,balance_after,description,created_at")
          .eq("member_id", member.id).order("created_at", { ascending: false }).limit(20);

        return Response.json({ member, history: history ?? [] });
      },
    },
  },
});
