import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Heart, Loader2, Gift, Cake, Home, MessageCircle } from "lucide-react";
import { walletToken } from "@/lib/wallet";

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
};
type LedgerRow = {
  id: string;
  type: string;
  points: number;
  balance_after: number;
  description: string | null;
  created_at: string;
};

const isNamed = (m: Member) => !!m.full_name && m.full_name !== "Guest Member";

function WalletPage() {
  const [member, setMember] = useState<Member | null>(null);
  const [history, setHistory] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState("");
  const [birthday, setBirthday] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async (profile?: { full_name?: string; birthday?: string }) => {
    const res = await fetch("/api/public/wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guest_token: walletToken(), profile }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) { setError(data?.error?.formErrors?.join(" ") ?? data?.error ?? "โหลดไม่สำเร็จ"); return null; }
    setMember(data.member as Member);
    setHistory((data.history ?? []) as LedgerRow[]);
    return data.member as Member;
  };

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, []);

  const saveProfile = async () => {
    if (!name.trim() && !birthday) { setEditOpen(false); return; }
    setSaving(true);
    const profile: { full_name?: string; birthday?: string } = {};
    if (name.trim()) profile.full_name = name.trim();
    if (birthday) profile.birthday = birthday;
    await load(profile);
    setSaving(false);
    setEditOpen(false);
    setName(""); setBirthday("");
  };

  if (loading) {
    return (
      <div className="min-h-dvh grid place-items-center bg-gradient-to-br from-amber-50 to-teal-50 p-4">
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลด…</div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-gradient-to-br from-amber-50 via-white to-teal-50 p-4">
      <div className="mx-auto max-w-md pt-8 pb-16 space-y-4">
        <div className="text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-primary text-primary-foreground grid place-items-center shadow">
            <Heart className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-2xl font-black">สมาชิก LONMOH</h1>
          <p className="text-sm text-muted-foreground">บัตรสมาชิกดิจิทัลของคุณ</p>
        </div>

        {error && (
          <Card className="border-destructive/40 bg-destructive/5"><CardContent className="p-4 text-sm text-destructive">{error}</CardContent></Card>
        )}

        {/* Points */}
        <Card>
          <CardContent className="p-5">
            <div className="rounded-2xl bg-amber-100 p-6 text-center">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">แต้มสะสม</div>
              <div className="mt-1 text-6xl font-black text-amber-700 tabular-nums">
                {Number(member?.current_points ?? 0).toLocaleString()}
              </div>
              <div className="text-sm text-amber-700">แต้ม</div>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <div className="min-w-0">
                <div className="font-semibold truncate">{member && isNamed(member) ? member.full_name : "สมาชิกทั่วไป"}</div>
                {member?.created_at && (
                  <div className="text-xs text-muted-foreground">สมาชิกตั้งแต่ {new Date(member.created_at).toLocaleDateString("th-TH")}</div>
                )}
              </div>
              {member?.member_level && member.member_level !== "-" && <Badge>{member.member_level}</Badge>}
            </div>
          </CardContent>
        </Card>

        {/* Progressive profile — optional, unlocks birthday perks */}
        {member && (!isNamed(member) || !member.birthday) && (
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base"><Cake className="h-4 w-4 text-primary" />รับสิทธิพิเศษเพิ่ม</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!editOpen ? (
                <>
                  <p className="text-sm text-muted-foreground">เพิ่มชื่อและวันเกิด รับส่วนลดวันเกิดและข่าวโปรโมชัน (ไม่บังคับ)</p>
                  <Button className="w-full" onClick={() => { setEditOpen(true); setName(isNamed(member) ? member.full_name : ""); setBirthday(member.birthday ?? ""); }}>เพิ่มข้อมูล</Button>
                </>
              ) : (
                <>
                  <div><Label className="text-xs">ชื่อ</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อของคุณ" /></div>
                  <div><Label className="text-xs">วันเกิด</Label><Input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} /></div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setEditOpen(false)} disabled={saving}>ยกเลิก</Button>
                    <Button className="flex-1" onClick={saveProfile} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "บันทึก"}</Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Promotions (managed later / LINE broadcast can mirror here) */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Gift className="h-4 w-4 text-primary" />โปรโมชัน</CardTitle></CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">ยังไม่มีโปรโมชันในขณะนี้ กลับมาดูใหม่เร็วๆ นี้ 🎉</p></CardContent>
        </Card>

        {/* Point history */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">ประวัติแต้ม</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">ยังไม่มีประวัติแต้ม</p>
            ) : history.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <div className="text-sm truncate">{row.description ?? row.type}</div>
                  <div className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleDateString("th-TH")}</div>
                </div>
                <div className={`font-bold tabular-nums ${row.points >= 0 ? "text-green-700" : "text-red-600"}`}>
                  {row.points >= 0 ? "+" : ""}{Number(row.points ?? 0).toLocaleString()}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* LINE — placeholder until LIFF is set up */}
        <Card className="border-dashed">
          <CardContent className="p-4 flex items-center gap-3">
            <MessageCircle className="h-5 w-5 text-green-600 flex-none" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">เชื่อมต่อ LINE</div>
              <div className="text-xs text-muted-foreground">เร็วๆ นี้ — เก็บแต้มข้ามเครื่องและรับข่าวสาร</div>
            </div>
            <Button variant="outline" size="sm" disabled>เร็วๆ นี้</Button>
          </CardContent>
        </Card>

        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <Home className="h-3.5 w-3.5" /> เพิ่มหน้านี้ไปที่หน้าจอหลักเพื่อเปิดบัตรสมาชิกได้ง่ายๆ
        </p>
      </div>
    </div>
  );
}
