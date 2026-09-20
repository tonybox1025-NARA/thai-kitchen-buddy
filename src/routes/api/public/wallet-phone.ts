import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

const MEMBER_COLS = "id,full_name,nickname,current_points,member_level,member_group_en,birthday,phone,created_at,line_user_id";

function client() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key, { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } });
}

const Body = z.object({
  guest_token: z.string().min(20).max(120),
  phone: z.string().min(8).max(30),
});

const normalizePhone = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "").replace(/^66(?=\d{9}$)/, "0");

export const Route = createFileRoute("/api/public/wallet-phone")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabase = client();
        if (!supabase) return new Response("Wallet is temporarily unavailable", { status: 503 });
        const raw = await request.json().catch(() => null);
        const parsed = Body.safeParse(raw);
        if (!parsed.success) return Response.json({ error: "Please enter a valid phone number" }, { status: 400 });
        const wanted = normalizePhone(parsed.data.phone);
        if (wanted.length < 9) return Response.json({ error: "Please enter a valid phone number" }, { status: 400 });

        const sb = supabase as any;
        const { data: current } = await sb.from("members")
          .select("id,current_points,line_user_id,guest_token,status")
          .eq("guest_token", parsed.data.guest_token).eq("status", "active").maybeSingle();
        if (!current?.line_user_id) {
          return Response.json({ error: "Connect LINE before linking an existing membership" }, { status: 409 });
        }

        const { data: candidates, error: candidateError } = await sb.from("members")
          .select(`${MEMBER_COLS},guest_token,status`).eq("status", "active").not("phone", "is", null);
        if (candidateError) return Response.json({ error: candidateError.message }, { status: 500 });
        const matches = (candidates ?? []).filter((m: any) => normalizePhone(m.phone) === wanted);
        if (matches.length !== 1) {
          return Response.json(
            { error: matches.length === 0 ? "Member not found" : "Duplicate phone records need staff review" },
            { status: matches.length === 0 ? 404 : 409 },
          );
        }
        const target = matches[0];
        if (target.id === current.id) return Response.json({ ok: true, member: target });
        if (target.line_user_id && target.line_user_id !== current.line_user_id) {
          return Response.json({ error: "This membership is already connected to another LINE account" }, { status: 409 });
        }

        const { count: ledgerCount } = await sb.from("member_point_ledger")
          .select("id", { count: "exact", head: true }).eq("member_id", current.id);
        if (Number(current.current_points ?? 0) !== 0 || Number(ledgerCount ?? 0) !== 0) {
          return Response.json({ error: "This LINE wallet has activity. Ask staff to merge it safely." }, { status: 409 });
        }

        const lineUserId = current.line_user_id;
        const { error: deleteError } = await sb.from("members").delete().eq("id", current.id);
        if (deleteError) return Response.json({ error: deleteError.message }, { status: 500 });
        const { data: member, error: linkError } = await sb.from("members")
          .update({ line_user_id: lineUserId, guest_token: parsed.data.guest_token, updated_at: new Date().toISOString() })
          .eq("id", target.id).select(MEMBER_COLS).single();
        if (linkError) return Response.json({ error: linkError.message }, { status: 500 });

        const { data: history } = await sb.from("member_point_ledger")
          .select("id,type,points,balance_after,description,created_at")
          .eq("member_id", member.id).order("created_at", { ascending: false }).limit(20);
        return Response.json({ ok: true, member, history: history ?? [] });
      },
    },
  },
});
