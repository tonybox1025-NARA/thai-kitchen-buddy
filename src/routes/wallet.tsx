import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Heart, Loader2, Gift, Cake, Home, MessageCircle, Check } from "lucide-react";
import { walletToken, LINE_LIFF_ID } from "@/lib/wallet";

export const Route = createFileRoute("/wallet")({
  component: WalletPage,
  head: () => ({
    meta: [
      { title: "LONMOH · สมาชิก" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
    ],
  }),
});

type Member = {
  id: string;
  full_name: string;
  nickname: string | null;
  current_points: number;
  member_level: string | null;
  member_group_en: string | null;
  birthday: string | null;
  phone: string | null;
  created_at: string | null;
  line_user_id: string | null;
};
type LedgerRow = {
  id: string;
  type: string;
  points: number;
  balance_after: number;
  description: string | null;
  created_at: string;
};

type Lang = "th" | "en";
const STR = {
  th: {
    title: "สมาชิก LONMOH", subtitle: "บัตรสมาชิกดิจิทัลของคุณ",
    points: "แต้มสะสม", pts: "แต้ม", member: "สมาชิกทั่วไป", since: "สมาชิกตั้งแต่",
    perks: "รับสิทธิพิเศษเพิ่ม", perksHint: "เพิ่มชื่อและวันเกิด รับส่วนลดวันเกิดและข่าวโปรโมชัน (ไม่บังคับ)",
    addInfo: "เพิ่มข้อมูล", name: "ชื่อ", namePh: "ชื่อของคุณ", birthday: "วันเกิด", cancel: "ยกเลิก", save: "บันทึก",
    promos: "โปรโมชัน", noPromos: "ยังไม่มีโปรโมชันในขณะนี้ กลับมาดูใหม่เร็วๆ นี้ 🎉",
    history: "ประวัติแต้ม", noHistory: "ยังไม่มีประวัติแต้ม",
    lineTitle: "เชื่อมต่อ LINE", lineHint: "เก็บแต้มข้ามเครื่องและรับข่าวสารโปรโมชัน", lineBtn: "เชื่อมต่อ",
    lineConnected: "เชื่อมต่อ LINE แล้ว", lineConnecting: "กำลังเชื่อมต่อ…", lineFail: "เชื่อมต่อ LINE ไม่สำเร็จ",
    home: "เพิ่มหน้านี้ไปที่หน้าจอหลักเพื่อเปิดบัตรสมาชิกได้ง่ายๆ", loading: "กำลังโหลด…", loadFail: "โหลดไม่สำเร็จ",
    locale: "th-TH",
  },
  en: {
    title: "LONMOH Member", subtitle: "Your digital membership card",
    points: "Points", pts: "points", member: "Member", since: "Member since",
    perks: "Get extra perks", perksHint: "Add your name and birthday for a birthday discount and promo news (optional)",
    addInfo: "Add details", name: "Name", namePh: "Your name", birthday: "Birthday", cancel: "Cancel", save: "Save",
    promos: "Promotions", noPromos: "No promotions right now — check back soon 🎉",
    history: "Point history", noHistory: "No point history yet",
    lineTitle: "Connect LINE", lineHint: "Keep your points across devices and get promo news", lineBtn: "Connect",
    lineConnected: "LINE connected", lineConnecting: "Connecting…", lineFail: "Couldn’t connect LINE",
    home: "Add this page to your home screen for quick access", loading: "Loading…", loadFail: "Couldn’t load",
    locale: "en-GB",
  },
} as const;

const isNamed = (m: Member) => !!m.full_name && m.full_name !== "Guest Member";

// Load the LINE LIFF SDK on demand (public wallet page — external scripts are fine).
async function loadLiff(): Promise<any> {
  const w = window as any;
  if (w.liff) return w.liff;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://static.line-scdn.net/liff/edge/2/sdk.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("LIFF SDK failed to load"));
    document.head.appendChild(s);
  });
  return (window as any).liff;
}

// LINE ID tokens are short-lived and the LIFF SDK caches the one from the last
// login without refreshing it. Decoding `exp` lets us skip verifying a stale
// token (which would make LINE return "IdToken expired") and re-login instead.
function idTokenExpired(token: string | null | undefined): boolean {
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return !payload.exp || payload.exp * 1000 < Date.now() + 10_000;
  } catch {
    return true;
  }
}

function WalletPage() {
  const [lang, setLang] = useState<Lang>("th");
  const s = STR[lang];

  const [member, setMember] = useState<Member | null>(null);
  const [history, setHistory] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState("");
  const [birthday, setBirthday] = useState("");
  const [saving, setSaving] = useState(false);
  const [lineBusy, setLineBusy] = useState(false);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? (localStorage.getItem("lonmoh_wallet_lang") as Lang | null) : null;
    if (saved === "th" || saved === "en") setLang(saved);
  }, []);
  const pickLang = (l: Lang) => { setLang(l); try { localStorage.setItem("lonmoh_wallet_lang", l); } catch { /* ignore */ } };

  const load = async (profile?: { full_name?: string; birthday?: string }) => {
    const res = await fetch("/api/public/wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guest_token: walletToken(), profile }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) { setError(data?.error?.formErrors?.join(" ") ?? data?.error ?? STR.th.loadFail); return null; }
    setMember(data.member as Member);
    setHistory((data.history ?? []) as LedgerRow[]);
    return data.member as Member;
  };

  useEffect(() => {
    setLoading(true);
    void load()
      .then((m) => { if (m && !m.line_user_id) void initLiff(); }) // only auto-link if not already linked
      .finally(() => setLoading(false));
  }, []);

  // Send a verified LINE ID token to link this wallet to the customer's LINE id.
  // `silent` is used for the automatic on-load attempt: a background failure (e.g.
  // a race) shouldn't flash a scary error banner — only the explicit tap should.
  const linkLine = async (idToken: string, silent = false) => {
    const res = await fetch("/api/public/wallet-line", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guest_token: walletToken(), id_token: idToken }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok) { setMember(data.member as Member); setHistory((data.history ?? []) as LedgerRow[]); }
    else if (!silent) setError(data?.error ?? STR.th.lineFail);
  };

  // On load: if the user just returned from the LINE login redirect with a FRESH
  // token, link automatically. If the cached token is expired we do nothing (no
  // error) — the wallet already loaded the right member by device token, and the
  // customer can tap Connect to refresh. This avoids the "token expired" banner
  // that used to appear on every revisit.
  const initLiff = async () => {
    try {
      const liff = await loadLiff();
      await liff.init({ liffId: LINE_LIFF_ID });
      if (liff.isLoggedIn()) {
        const idToken = liff.getIDToken();
        if (idToken && !idTokenExpired(idToken)) await linkLine(idToken, true);
      }
    } catch { /* LINE is optional — ignore init failures */ }
  };

  const connectLine = async () => {
    setLineBusy(true);
    try {
      const liff = await loadLiff();
      await liff.init({ liffId: LINE_LIFF_ID });
      const idToken = liff.isLoggedIn() ? liff.getIDToken() : null;
      // Not logged in, or the cached token is stale → (re)login to get a fresh one.
      // LINE redirects back here and initLiff() links with the new token.
      if (!liff.isLoggedIn() || idTokenExpired(idToken)) { liff.login(); return; }
      await linkLine(idToken as string);
    } catch (e: any) {
      setError(e?.message ?? s.lineFail);
    } finally {
      setLineBusy(false);
    }
  };

  const saveProfile = async () => {
    if (!name.trim() && !birthday) { setEditOpen(false); return; }
    setSaving(true);
    const profile: { full_name?: string; birthday?: string } = {};
    if (name.trim()) profile.full_name = name.trim();
    if (birthday) profile.birthday = birthday;
    await load(profile);
    setSaving(false); setEditOpen(false); setName(""); setBirthday("");
  };

  const LangToggle = () => (
    <div className="inline-flex rounded-full border bg-white/70 p-0.5 text-xs">
      {(["th", "en"] as Lang[]).map((l) => (
        <button key={l} onClick={() => pickLang(l)}
          className={`px-3 py-1 rounded-full font-semibold transition-colors ${lang === l ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
          {l === "th" ? "ไทย" : "EN"}
        </button>
      ))}
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-dvh grid place-items-center bg-gradient-to-br from-amber-50 to-teal-50 p-4">
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {s.loading}</div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-gradient-to-br from-amber-50 via-white to-teal-50 p-4">
      <div className="mx-auto max-w-md pt-6 pb-16 space-y-4">
        <div className="flex justify-end"><LangToggle /></div>
        <div className="text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-primary text-primary-foreground grid place-items-center shadow">
            <Heart className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-2xl font-black">{s.title}</h1>
          <p className="text-sm text-muted-foreground">{s.subtitle}</p>
        </div>

        {error && (
          <Card className="border-destructive/40 bg-destructive/5"><CardContent className="p-4 text-sm text-destructive">{error}</CardContent></Card>
        )}

        {/* Points */}
        <Card>
          <CardContent className="p-5">
            <div className="rounded-2xl bg-amber-100 p-6 text-center">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">{s.points}</div>
              <div className="mt-1 text-6xl font-black text-amber-700 tabular-nums">{Number(member?.current_points ?? 0).toLocaleString()}</div>
              <div className="text-sm text-amber-700">{s.pts}</div>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <div className="min-w-0">
                <div className="font-semibold truncate">{member && isNamed(member) ? member.full_name : s.member}</div>
                {member?.created_at && (
                  <div className="text-xs text-muted-foreground">{s.since} {new Date(member.created_at).toLocaleDateString(s.locale)}</div>
                )}
              </div>
              {member?.member_level && member.member_level !== "-" && <Badge>{member.member_level}</Badge>}
            </div>
          </CardContent>
        </Card>

        {/* Progressive profile */}
        {member && (!isNamed(member) || !member.birthday) && (
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Cake className="h-4 w-4 text-primary" />{s.perks}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {!editOpen ? (
                <>
                  <p className="text-sm text-muted-foreground">{s.perksHint}</p>
                  <Button className="w-full" onClick={() => { setEditOpen(true); setName(isNamed(member) ? member.full_name : ""); setBirthday(member.birthday ?? ""); }}>{s.addInfo}</Button>
                </>
              ) : (
                <>
                  <div><Label className="text-xs">{s.name}</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={s.namePh} /></div>
                  <div><Label className="text-xs">{s.birthday}</Label><Input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} /></div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setEditOpen(false)} disabled={saving}>{s.cancel}</Button>
                    <Button className="flex-1" onClick={saveProfile} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : s.save}</Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Promotions */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Gift className="h-4 w-4 text-primary" />{s.promos}</CardTitle></CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">{s.noPromos}</p></CardContent>
        </Card>

        {/* Point history */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{s.history}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">{s.noHistory}</p>
            ) : history.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <div className="text-sm truncate">{row.description ?? row.type}</div>
                  <div className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleDateString(s.locale)}</div>
                </div>
                <div className={`font-bold tabular-nums ${row.points >= 0 ? "text-green-700" : "text-red-600"}`}>
                  {row.points >= 0 ? "+" : ""}{Number(row.points ?? 0).toLocaleString()}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* LINE connect */}
        <Card className={member?.line_user_id ? "border-green-300 bg-green-50" : "border-dashed"}>
          <CardContent className="p-4 flex items-center gap-3">
            <MessageCircle className="h-5 w-5 text-green-600 flex-none" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{member?.line_user_id ? s.lineConnected : s.lineTitle}</div>
              {!member?.line_user_id && <div className="text-xs text-muted-foreground">{s.lineHint}</div>}
            </div>
            {member?.line_user_id
              ? <Check className="h-5 w-5 text-green-600 flex-none" />
              : <Button size="sm" onClick={connectLine} disabled={lineBusy}>{lineBusy ? s.lineConnecting : s.lineBtn}</Button>}
          </CardContent>
        </Card>

        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <Home className="h-3.5 w-3.5" /> {s.home}
        </p>
      </div>
    </div>
  );
}
