import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { thb } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Gift, MinusCircle, PlusCircle, RefreshCw, Search, UserPlus } from "lucide-react";

export const Route = createFileRoute("/_app/loyalty")({ component: LoyaltyPage });

type Member = {
  id: string;
  full_name: string;
  nickname: string | null;
  phone: string | null;
  member_group_en: string | null;
  current_points: number;
  legacy_visit_count: number;
  legacy_total_spend: number;
  status: string;
};

type LedgerRow = {
  id: string;
  type: string;
  points: number;
  balance_after: number;
  description: string | null;
  created_at: string;
};

type LoyaltySettings = {
  loyalty_enabled: boolean;
  loyalty_points_per_baht: number;
  loyalty_signup_bonus: number;
};

const cleanPhone = (value: string) => value.replace(/[^\d+]/g, "");
const formatDate = (value: string) => new Date(value).toLocaleString();

function LoyaltyPage() {
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Member | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [settings, setSettings] = useState<LoyaltySettings>({
    loyalty_enabled: true,
    loyalty_points_per_baht: 1,
    loyalty_signup_bonus: 300,
  });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [earnReceipt, setEarnReceipt] = useState("");
  const [earnAmount, setEarnAmount] = useState("");
  const [earnNote, setEarnNote] = useState("");

  const [redeemReceipt, setRedeemReceipt] = useState("");
  const [redeemPoints, setRedeemPoints] = useState("");
  const [redeemNote, setRedeemNote] = useState("");

  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNick, setNewNick] = useState("");
  const [newPhone, setNewPhone] = useState("");

  const earnPoints = useMemo(() => {
    const amount = Number(earnAmount || 0);
    return Math.max(0, Math.floor(amount * Number(settings.loyalty_points_per_baht ?? 1)));
  }, [earnAmount, settings.loyalty_points_per_baht]);

  const redeemValue = Math.max(0, Math.floor(Number(redeemPoints || 0)));

  const loadSettings = async () => {
    const { data, error } = await supabase
      .from("settings")
      .select("loyalty_enabled,loyalty_points_per_baht,loyalty_signup_bonus")
      .eq("id", 1)
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data) setSettings(data as LoyaltySettings);
  };

  const searchMembers = async () => {
    setLoading(true);
    const term = query.trim().replace(/[%,()]/g, "");
    let req = supabase
      .from("members")
      .select("id,full_name,nickname,phone,member_group_en,current_points,legacy_visit_count,legacy_total_spend,status")
      .order("current_points", { ascending: false })
      .limit(50);

    if (term) {
      req = req.or(`full_name.ilike.%${term}%,nickname.ilike.%${term}%,phone.ilike.%${term}%`);
    }

    const { data, error } = await req;
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setMembers((data ?? []) as Member[]);
  };

  const loadLedger = async (memberId: string) => {
    const { data, error } = await supabase
      .from("member_point_ledger")
      .select("id,type,points,balance_after,description,created_at")
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      toast.error(error.message);
      return;
    }
    setLedger((data ?? []) as LedgerRow[]);
  };

  const selectMember = async (member: Member) => {
    setSelected(member);
    await loadLedger(member.id);
  };

  const refreshSelected = async () => {
    if (!selected) return;
    const { data, error } = await supabase
      .from("members")
      .select("id,full_name,nickname,phone,member_group_en,current_points,legacy_visit_count,legacy_total_spend,status")
      .eq("id", selected.id)
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    const member = data as Member;
    setSelected(member);
    setMembers((prev) => prev.map((m) => m.id === member.id ? member : m));
    await loadLedger(member.id);
  };

  const postPoints = async (type: "earn" | "redeem", points: number, description: string) => {
    if (!selected || points <= 0) return;
    setBusy(true);
    try {
      const { data: fresh, error: freshErr } = await supabase
        .from("members")
        .select("current_points")
        .eq("id", selected.id)
        .single();
      if (freshErr || !fresh) throw freshErr ?? new Error("Could not load current points");

      const current = Number((fresh as any).current_points ?? 0);
      const balanceAfter = type === "earn" ? current + points : current - points;
      if (balanceAfter < 0) {
        toast.error("Not enough points");
        return;
      }

      const { error: updateErr } = await supabase
        .from("members")
        .update({ current_points: balanceAfter, updated_at: new Date().toISOString() })
        .eq("id", selected.id);
      if (updateErr) throw updateErr;

      const { error: ledgerErr } = await supabase.from("member_point_ledger").insert({
        member_id: selected.id,
        type,
        points: type === "earn" ? points : -points,
        balance_after: balanceAfter,
        description,
      });
      if (ledgerErr) throw ledgerErr;

      toast.success(type === "earn" ? `Added ${points.toLocaleString()} points` : `Redeemed ${points.toLocaleString()} points`);
      await refreshSelected();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Point update failed");
    } finally {
      setBusy(false);
    }
  };

  const earn = async () => {
    if (!selected) return;
    if (!settings.loyalty_enabled) { toast.error("Loyalty is disabled"); return; }
    const amount = Number(earnAmount || 0);
    if (amount <= 0 || earnPoints <= 0) { toast.error("Enter MERI paid amount"); return; }
    const desc = [
      `MERI earn ${thb(amount)}`,
      earnReceipt.trim() ? `Receipt: ${earnReceipt.trim()}` : null,
      earnNote.trim() || null,
    ].filter(Boolean).join(" · ");
    await postPoints("earn", earnPoints, desc);
    setEarnAmount("");
    setEarnReceipt("");
    setEarnNote("");
  };

  const redeem = async () => {
    if (!selected) return;
    const points = Math.floor(Number(redeemPoints || 0));
    if (points <= 0) { toast.error("Enter points to redeem"); return; }
    if (points > Number(selected.current_points ?? 0)) { toast.error("Not enough points"); return; }
    const ok = window.confirm(`Redeem ${points.toLocaleString()} points for ${thb(points)} discount?\n\nEnter the same discount in MERI before checkout.`);
    if (!ok) return;
    const desc = [
      `MERI redeem ${thb(points)} discount`,
      redeemReceipt.trim() ? `Receipt: ${redeemReceipt.trim()}` : null,
      redeemNote.trim() || null,
    ].filter(Boolean).join(" · ");
    await postPoints("redeem", points, desc);
    setRedeemPoints("");
    setRedeemReceipt("");
    setRedeemNote("");
  };

  const createMember = async () => {
    const fullName = newName.trim();
    const phone = cleanPhone(newPhone.trim());
    if (!fullName) { toast.error("Customer name is required"); return; }
    if (!phone) { toast.error("Phone is required"); return; }

    setBusy(true);
    try {
      const signup = Math.max(0, Math.floor(Number(settings.loyalty_signup_bonus ?? 0)));
      const { data, error } = await supabase
        .from("members")
        .insert({
          full_name: fullName,
          nickname: newNick.trim() || null,
          phone,
          opening_points: signup,
          current_points: signup,
          imported_from: "loyalty_desk",
        })
        .select("id,full_name,nickname,phone,member_group_en,current_points,legacy_visit_count,legacy_total_spend,status")
        .single();
      if (error) throw error;

      if (signup > 0) {
        await supabase.from("member_point_ledger").insert({
          member_id: data.id,
          type: "signup_bonus",
          points: signup,
          balance_after: signup,
          description: "Signup bonus from Loyalty Desk",
        });
      }

      toast.success("Member created");
      setNewOpen(false);
      setNewName("");
      setNewNick("");
      setNewPhone("");
      setMembers((prev) => [data as Member, ...prev]);
      await selectMember(data as Member);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create member");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void loadSettings(); void searchMembers(); }, []);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">Loyalty Desk</h1>
          <p className="text-sm text-muted-foreground">Use while MERI handles orders and payments. Staff records point earn/redeem here.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => void searchMembers()} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
          <Button onClick={() => setNewOpen(true)}>
            <UserPlus className="h-4 w-4 mr-2" />New member
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(20rem,30rem)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Find customer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Phone, name, nickname..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void searchMembers(); }}
                />
              </div>
              <Button onClick={() => void searchMembers()} disabled={loading}>Search</Button>
            </div>

            <div className="space-y-2 max-h-[calc(100vh-18rem)] overflow-auto pr-1">
              {members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => void selectMember(member)}
                  className={`w-full rounded-lg border p-3 text-left transition hover:bg-muted ${selected?.id === member.id ? "border-primary bg-primary/5" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{member.full_name}</div>
                      <div className="text-sm text-muted-foreground truncate">
                        {[member.nickname, member.phone, member.member_group_en].filter(Boolean).join(" · ") || "No phone"}
                      </div>
                    </div>
                    <Badge variant="secondary">{Number(member.current_points ?? 0).toLocaleString()} pts</Badge>
                  </div>
                </button>
              ))}
              {!loading && members.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">No members found.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {!selected ? (
            <Card>
              <CardContent className="py-14 text-center text-muted-foreground">
                Search and select a customer to earn or redeem points.
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardContent className="py-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="h-12 w-12 rounded-full bg-primary/10 text-primary grid place-items-center">
                      <Gift className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-xl font-bold truncate">{selected.full_name}</h2>
                      <p className="text-sm text-muted-foreground">{[selected.nickname, selected.phone, selected.member_group_en].filter(Boolean).join(" · ")}</p>
                    </div>
                    <div className="ml-auto text-right">
                      <div className="text-sm text-muted-foreground">Current points</div>
                      <div className="text-3xl font-bold">{Number(selected.current_points ?? 0).toLocaleString()}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><PlusCircle className="h-4 w-4 text-green-600" />Earn points</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <Label>MERI receipt no.</Label>
                      <Input value={earnReceipt} onChange={(e) => setEarnReceipt(e.target.value)} placeholder="Optional" />
                    </div>
                    <div>
                      <Label>MERI paid amount</Label>
                      <Input type="number" min={0} step="0.01" value={earnAmount} onChange={(e) => setEarnAmount(e.target.value)} />
                    </div>
                    <div className="rounded-lg border bg-muted/40 p-3">
                      <div className="text-sm text-muted-foreground">Points to add</div>
                      <div className="text-2xl font-bold">{earnPoints.toLocaleString()} pts</div>
                    </div>
                    <div>
                      <Label>Note</Label>
                      <Textarea value={earnNote} onChange={(e) => setEarnNote(e.target.value)} placeholder="Optional" rows={3} />
                    </div>
                    <Button className="w-full" onClick={() => void earn()} disabled={busy || earnPoints <= 0}>
                      Add points
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><MinusCircle className="h-4 w-4 text-destructive" />Redeem points</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <Label>MERI receipt no.</Label>
                      <Input value={redeemReceipt} onChange={(e) => setRedeemReceipt(e.target.value)} placeholder="Optional" />
                    </div>
                    <div>
                      <Label>Points to redeem</Label>
                      <Input type="number" min={0} max={selected.current_points} step="1" value={redeemPoints} onChange={(e) => setRedeemPoints(e.target.value)} />
                    </div>
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                      <div className="text-sm text-muted-foreground">Enter this discount in MERI</div>
                      <div className="text-2xl font-bold">{thb(redeemValue)}</div>
                    </div>
                    <div>
                      <Label>Note</Label>
                      <Textarea value={redeemNote} onChange={(e) => setRedeemNote(e.target.value)} placeholder="Optional" rows={3} />
                    </div>
                    <Button className="w-full" variant="destructive" onClick={() => void redeem()} disabled={busy || redeemValue <= 0 || redeemValue > Number(selected.current_points ?? 0)}>
                      Confirm redeem
                    </Button>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader><CardTitle className="text-base">Recent point history</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {ledger.map((row) => (
                    <div key={row.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[8rem_7rem_1fr_10rem] sm:items-center">
                      <Badge variant={row.points >= 0 ? "secondary" : "destructive"} className="w-fit">{row.type}</Badge>
                      <div className={`font-bold ${row.points >= 0 ? "text-green-700" : "text-destructive"}`}>
                        {row.points >= 0 ? "+" : ""}{row.points.toLocaleString()}
                      </div>
                      <div className="text-sm text-muted-foreground">{row.description ?? "-"}</div>
                      <div className="text-xs text-muted-foreground sm:text-right">{formatDate(row.created_at)}</div>
                    </div>
                  ))}
                  {ledger.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No point history yet.</p>}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New loyalty member</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div>
              <Label>Nickname</Label>
              <Input value={newNick} onChange={(e) => setNewNick(e.target.value)} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
            </div>
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              Signup bonus: <span className="font-bold">{Number(settings.loyalty_signup_bonus ?? 0).toLocaleString()} pts</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button onClick={() => void createMember()} disabled={busy}>Create member</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
