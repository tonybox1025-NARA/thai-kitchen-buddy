import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { thb } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RefreshCw, Search, Upload } from "lucide-react";

export const Route = createFileRoute("/_app/members")({ component: MembersPage });

type Member = {
  id: string;
  full_name: string;
  nickname: string | null;
  phone: string | null;
  member_group_en: string | null;
  member_level: string | null;
  current_points: number;
  legacy_visit_count: number;
  legacy_total_spend: number;
  legacy_last_visit_at: string | null;
  status: string;
  guest_token: string | null;
  // Computed at load time: MERI seed (legacy_*) + live POS activity from bills.
  pos_visits: number;
  pos_spend: number;
  visits: number;       // legacy_visit_count + pos_visits
  spend: number;        // legacy_total_spend + pos_spend
  last_visit: string | null; // latest of legacy_last_visit_at / POS bills (YYYY-MM-DD)
};

type MemberActivity = { visits: number; spend: number; lastVisit: string | null };

type PointLedgerRow = {
  id: string;
  type: string;
  points: number;
  balance_after: number;
  description: string | null;
  created_at: string;
  bill_id: string | null;
};

type LoyaltySettings = {
  loyalty_enabled: boolean;
  loyalty_points_per_baht: number;
  loyalty_signup_bonus: number;
  loyalty_points_expire_months: number;
};

type ImportRow = {
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  nickname: string | null;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  gender: string | null;
  member_group_th: string | null;
  member_group_en: string | null;
  member_level: string | null;
  opening_points: number;
  current_points: number;
  legacy_visit_count: number;
  legacy_total_spend: number;
  legacy_average_spend: number;
  legacy_last_visit_at: string | null;
  imported_from: string;
  legacy_source_row: number;
};

function clean(v: string | undefined) {
  const s = String(v ?? "").trim();
  return !s || s === "-" ? null : s;
}

function parseMoney(v: string | undefined) {
  return Number(String(v ?? "0").replace(/,/g, "").trim() || 0);
}

function parseIntish(v: string | undefined) {
  return Math.round(parseMoney(v));
}

function parseThaiDate(v: string | undefined) {
  const s = clean(v);
  if (!s) return null;
  const [dd, mm, yyyy] = s.split("/");
  if (!dd || !mm || !yyyy) return null;
  return `${yyyy.padStart(4, "0")}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (c === "\"" && next === "\"") { cell += "\""; i += 1; }
      else if (c === "\"") quoted = false;
      else cell += c;
    } else if (c === "\"") quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function mapDotdashRows(text: string): ImportRow[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  const header = rows[0]?.map((h) => h.replace(/^\uFEFF/, "").trim()) ?? [];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const value = (row: string[], key: string) => row[idx[key]] ?? "";

  return rows.slice(1).map((row, i) => {
    const first = clean(value(row, "ชื่อจริง"));
    const last = clean(value(row, "นามสกุล"));
    const nick = clean(value(row, "ชื่อเล่น"));
    const full = [first, last, nick].filter(Boolean).join(" ").trim() || `Dotdash customer ${i + 1}`;
    const points = parseIntish(value(row, "แต้มที่ใช้ได้"));
    return {
      full_name: full,
      first_name: first,
      last_name: last,
      nickname: nick,
      phone: clean(value(row, "เบอร์โทรศัพท์")),
      email: clean(value(row, "อีเมล")),
      birthday: parseThaiDate(value(row, "วันเดือนปีเกิด")),
      gender: clean(value(row, "เพศ")),
      member_group_th: clean(value(row, "กลุ่มลูกค้า (TH)")),
      member_group_en: clean(value(row, "กลุ่มลูกค้า (EN)")),
      member_level: clean(value(row, "ระดับสมาชิก")),
      opening_points: points,
      current_points: points,
      legacy_visit_count: parseIntish(value(row, "จำนวนครั้งที่ใช้บริการ")),
      legacy_total_spend: parseMoney(value(row, "ยอดใช้จ่าย")),
      legacy_average_spend: parseMoney(value(row, "ยอดใช้จ่ายเฉลี่ย")),
      legacy_last_visit_at: parseThaiDate(value(row, "ใช้บริการครั้งล่าสุด")),
      imported_from: "dotdash",
      legacy_source_row: parseIntish(value(row, "ลำดับที่")) || i + 1,
    };
  });
}

async function insertInBatches(rows: ImportRow[]) {
  const size = 400;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const { error } = await supabase.from("members").insert(chunk);
    if (error) throw error;
  }
}

async function fetchAllMembers() {
  const pageSize = 1000;
  const all: Member[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("members")
      .select("id,full_name,nickname,phone,member_group_en,member_level,current_points,legacy_visit_count,legacy_total_spend,legacy_last_visit_at,status,guest_token")
      .order("current_points", { ascending: false })
      .range(from, to);
    if (error) throw error;
    const page = (data ?? []) as Member[];
    all.push(...page);
    if (page.length < pageSize) break;
  }

  return all;
}

/** Live POS activity per member, aggregated from paid bills. This is the source of
 *  truth going forward — no counters to drift. Combined with the MERI legacy_* seed. */
async function fetchMemberActivity(): Promise<Map<string, MemberActivity>> {
  const map = new Map<string, MemberActivity>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("bills")
      .select("member_id,total,paid_at")
      .not("member_id", "is", null)
      .in("status", ["paid", "partial_refund"])
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as { member_id: string; total: number; paid_at: string | null }[];
    for (const b of page) {
      const cur = map.get(b.member_id) ?? { visits: 0, spend: 0, lastVisit: null };
      cur.visits += 1;
      cur.spend += Number(b.total ?? 0);
      const day = b.paid_at ? b.paid_at.slice(0, 10) : null;
      if (day && (!cur.lastVisit || day > cur.lastVisit)) cur.lastVisit = day;
      map.set(b.member_id, cur);
    }
    if (page.length < pageSize) break;
  }
  return map;
}

/** Merge the MERI seed row with its live POS activity into display totals. */
function enrichMember(m: Member, act: MemberActivity | undefined): Member {
  const pos_visits = act?.visits ?? 0;
  const pos_spend = act?.spend ?? 0;
  const last_visit = [m.legacy_last_visit_at, act?.lastVisit ?? null]
    .filter(Boolean)
    .sort()
    .pop() ?? null;
  return {
    ...m,
    pos_visits,
    pos_spend,
    visits: Number(m.legacy_visit_count ?? 0) + pos_visits,
    spend: Number(m.legacy_total_spend ?? 0) + pos_spend,
    last_visit,
  };
}

function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [settings, setSettings] = useState<LoyaltySettings>({
    loyalty_enabled: true,
    loyalty_points_per_baht: 1,
    loyalty_signup_bonus: 300,
    loyalty_points_expire_months: 6,
  });
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [ledgerRows, setLedgerRows] = useState<PointLedgerRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) =>
      [m.full_name, m.nickname, m.phone, m.member_group_en, m.member_level]
        .some((v) => String(v ?? "").toLowerCase().includes(q)),
    );
  }, [members, query]);

  const stats = useMemo(() => ({
    count: members.length,
    withPhone: members.filter((m) => m.phone).length,
    points: members.reduce((s, m) => s + Number(m.current_points ?? 0), 0),
    spend: members.reduce((s, m) => s + Number(m.spend ?? 0), 0),
  }), [members]);

  const load = async () => {
    setLoading(true);
    const [memberResult, activityResult, { data: settingsRow, error: settingsErr }] = await Promise.all([
      fetchAllMembers().then((data) => ({ data, error: null as Error | null })).catch((error: Error) => ({ data: [] as Member[], error })),
      fetchMemberActivity().then((data) => ({ data, error: null as Error | null })).catch((error: Error) => ({ data: new Map<string, MemberActivity>(), error })),
      supabase
        .from("settings")
        .select("loyalty_enabled,loyalty_points_per_baht,loyalty_signup_bonus,loyalty_points_expire_months")
        .eq("id", 1)
        .single(),
    ]);
    setLoading(false);
    if (memberResult.error) { toast.error(memberResult.error.message); return; }
    if (settingsErr) toast.error(settingsErr.message);
    const activity = activityResult.data;
    setMembers(memberResult.data.map((m) => enrichMember(m, activity.get(m.id))));
    if (settingsRow) setSettings(settingsRow as LoyaltySettings);
  };

  useEffect(() => { void load(); }, []);

  const saveSettings = async () => {
    const { error } = await supabase.from("settings").update(settings).eq("id", 1);
    if (error) { toast.error(error.message); return; }
    toast.success("Loyalty settings saved");
  };

  const onFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    const rows = mapDotdashRows(text);
    setImportRows(rows);
    setConfirmReplace(false);
    toast.success(`Ready to import ${rows.length} customers`);
  };

  const doImport = async () => {
    if (importRows.length === 0) return;
    setImporting(true);
    try {
      await insertInBatches(importRows);
      toast.success(`Imported ${importRows.length} members`);
      setImportOpen(false);
      setImportRows([]);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  // Re-sync with a fresh MERI/DotDash export: delete the previous DotDash import,
  // then insert the new rows. Used because the export has no stable key to match on.
  // Members earned/redeemed in the POS (imported_from = null) are left untouched;
  // member_point_ledger cascades on delete, and bills.member_id is set null.
  const doReplace = async () => {
    if (importRows.length === 0) return;
    setImporting(true);
    try {
      const { error: delErr } = await supabase.from("members").delete().eq("imported_from", "dotdash");
      if (delErr) throw delErr;
      await insertInBatches(importRows);
      toast.success(`Replaced DotDash members · imported ${importRows.length}`);
      setImportOpen(false);
      setImportRows([]);
      setConfirmReplace(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Replace failed");
    } finally {
      setImporting(false);
    }
  };

  const openMemberDetail = async (member: Member) => {
    setSelectedMember(member);
    setLedgerRows([]);
    setDetailLoading(true);
    const { data, error } = await supabase
      .from("member_point_ledger")
      .select("id,type,points,balance_after,description,created_at,bill_id")
      .eq("member_id", member.id)
      .order("created_at", { ascending: false })
      .limit(100);
    setDetailLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setLedgerRows((data ?? []) as PointLedgerRow[]);
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">Members</h1>
          <p className="text-sm text-muted-foreground">LONMOH Loyalty, Dotdash import, points, and customer history.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
          <Button onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />Import Dotdash CSV
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card><CardHeader><CardTitle className="text-sm">Members</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{stats.count}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">With phone</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{stats.withPhone}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Available points</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{stats.points.toLocaleString()}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Total spend</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{thb(stats.spend)}</CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle className="text-base">Customer list</CardTitle>
              <div className="relative ml-auto w-full sm:w-80">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="Search name, phone, group..." value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead className="text-right">Points</TableHead>
                  <TableHead className="text-right">Visits</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead>Last visit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 200).map((m) => (
                  <TableRow key={m.id} className="cursor-pointer hover:bg-muted/50" onClick={() => void openMemberDetail(m)}>
                    <TableCell>
                      <div className="font-medium">{m.full_name}</div>
                      {m.nickname && <div className="text-xs text-muted-foreground">{m.nickname}</div>}
                    </TableCell>
                    <TableCell>{m.phone ?? "-"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {m.member_group_en && <Badge variant="secondary">{m.member_group_en}</Badge>}
                        {m.member_level && m.member_level !== "-" && <Badge>{m.member_level}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold">{Number(m.current_points ?? 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right">{m.visits}</TableCell>
                    <TableCell className="text-right">{thb(m.spend)}</TableCell>
                    <TableCell>{m.last_visit ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filtered.length > 200 && <p className="mt-3 text-xs text-muted-foreground">Showing first 200 matching members. Use search to narrow the list.</p>}
            {filtered.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No members found.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Loyalty settings</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label>Use loyalty</Label>
              <Switch checked={settings.loyalty_enabled} onCheckedChange={(v) => setSettings({ ...settings, loyalty_enabled: v })} />
            </div>
            <div>
              <Label>Points per baht</Label>
              <Input type="number" min={0} step="0.01" value={settings.loyalty_points_per_baht}
                onChange={(e) => setSettings({ ...settings, loyalty_points_per_baht: Number(e.target.value) })} />
              <p className="mt-1 text-xs text-muted-foreground">Dotdash screenshot shows 1 baht = 1 point.</p>
            </div>
            <div>
              <Label>Sign-up bonus points</Label>
              <Input type="number" min={0} value={settings.loyalty_signup_bonus}
                onChange={(e) => setSettings({ ...settings, loyalty_signup_bonus: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Points expire after months</Label>
              <Input type="number" min={0} value={settings.loyalty_points_expire_months}
                onChange={(e) => setSettings({ ...settings, loyalty_points_expire_months: Number(e.target.value) })} />
            </div>
            <Button className="w-full" onClick={saveSettings}>Save loyalty settings</Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!selectedMember} onOpenChange={(open) => {
        if (!open) {
          setSelectedMember(null);
          setLedgerRows([]);
        }
      }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{selectedMember?.full_name ?? "Member detail"}</DialogTitle>
          </DialogHeader>
          {selectedMember && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {selectedMember.nickname && <span>{selectedMember.nickname}</span>}
                {selectedMember.phone && <span>{selectedMember.phone}</span>}
                {selectedMember.member_group_en && <Badge variant="secondary">{selectedMember.member_group_en}</Badge>}
                {selectedMember.member_level && selectedMember.member_level !== "-" && <Badge>{selectedMember.member_level}</Badge>}
                {selectedMember.guest_token && <Badge variant="outline">Guest wallet linked</Badge>}
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Current points</div><div className="text-xl font-bold">{Number(selectedMember.current_points ?? 0).toLocaleString()}</div></CardContent></Card>
                <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Visits</div><div className="text-xl font-bold">{selectedMember.visits}</div>{selectedMember.pos_visits > 0 && <div className="text-[10px] text-muted-foreground mt-0.5">{selectedMember.pos_visits} in POS · {selectedMember.legacy_visit_count} imported</div>}</CardContent></Card>
                <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Total spend</div><div className="text-xl font-bold">{thb(selectedMember.spend)}</div>{selectedMember.pos_spend > 0 && <div className="text-[10px] text-muted-foreground mt-0.5">{thb(selectedMember.pos_spend)} in POS</div>}</CardContent></Card>
                <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Last visit</div><div className="text-xl font-bold">{selectedMember.last_visit ?? "-"}</div></CardContent></Card>
              </div>
              <div className="rounded-lg border">
                <div className="border-b p-3 font-medium">Point history</div>
                {detailLoading ? (
                  <div className="p-4 text-sm text-muted-foreground">Loading history...</div>
                ) : ledgerRows.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground">No point history yet. Imported Dotdash points are shown as the opening/current balance.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Points</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledgerRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{new Date(row.created_at).toLocaleString()}</TableCell>
                          <TableCell><Badge variant="outline">{row.type}</Badge></TableCell>
                          <TableCell>{row.description ?? row.bill_id ?? "-"}</TableCell>
                          <TableCell className={`text-right font-semibold ${row.points >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                            {row.points >= 0 ? "+" : ""}{Number(row.points ?? 0).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">{Number(row.balance_after ?? 0).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSelectedMember(null); setLedgerRows([]); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import Dotdash customer CSV</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>CSV file</Label>
              <Input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Rows</div><div className="text-xl font-bold">{importRows.length}</div></CardContent></Card>
              <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">With phone</div><div className="text-xl font-bold">{importRows.filter((r) => r.phone).length}</div></CardContent></Card>
              <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">With points</div><div className="text-xl font-bold">{importRows.filter((r) => r.current_points > 0).length}</div></CardContent></Card>
              <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Points</div><div className="text-xl font-bold">{importRows.reduce((s, r) => s + r.current_points, 0).toLocaleString()}</div></CardContent></Card>
            </div>
            {importRows.length > 0 && (
              <div className="rounded-lg border p-3 text-sm">
                <div className="font-medium">Preview</div>
                <div className="mt-1 text-muted-foreground">
                  {importRows[0].full_name} · {importRows[0].phone ?? "no phone"} · {importRows[0].current_points.toLocaleString()} points
                </div>
              </div>
            )}
            {confirmReplace && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm space-y-1">
                <div className="font-semibold text-destructive">Replace previous DotDash import?</div>
                <p className="text-muted-foreground">
                  This deletes every member imported from DotDash and re-imports the {importRows.length.toLocaleString()} rows
                  from this file. Members added or edited inside the POS (not from DotDash) are kept.
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => { setImportOpen(false); setConfirmReplace(false); }}>Cancel</Button>
            <Button variant="outline" onClick={doImport} disabled={importRows.length === 0 || importing}>
              {importing ? "Working…" : "Add only"}
            </Button>
            {confirmReplace ? (
              <Button variant="destructive" onClick={doReplace} disabled={importRows.length === 0 || importing}>
                {importing ? "Replacing…" : `Confirm — delete old & import ${importRows.length.toLocaleString()}`}
              </Button>
            ) : (
              <Button onClick={() => setConfirmReplace(true)} disabled={importRows.length === 0 || importing}>
                <RefreshCw className="h-4 w-4 mr-2" />Replace previous import
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
