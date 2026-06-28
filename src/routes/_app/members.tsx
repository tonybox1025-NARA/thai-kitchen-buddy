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
import { Download, RefreshCw, Search, Upload } from "lucide-react";

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
    spend: members.reduce((s, m) => s + Number(m.legacy_total_spend ?? 0), 0),
  }), [members]);

  const load = async () => {
    setLoading(true);
    const [{ data: memberRows, error: membersErr }, { data: settingsRow, error: settingsErr }] = await Promise.all([
      supabase
        .from("members")
        .select("id,full_name,nickname,phone,member_group_en,member_level,current_points,legacy_visit_count,legacy_total_spend,legacy_last_visit_at,status")
        .order("current_points", { ascending: false })
        .limit(1000),
      supabase
        .from("settings")
        .select("loyalty_enabled,loyalty_points_per_baht,loyalty_signup_bonus,loyalty_points_expire_months")
        .eq("id", 1)
        .single(),
    ]);
    setLoading(false);
    if (membersErr) { toast.error(membersErr.message); return; }
    if (settingsErr) toast.error(settingsErr.message);
    setMembers((memberRows ?? []) as Member[]);
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
        <Card><CardHeader><CardTitle className="text-sm">Legacy spend</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{thb(stats.spend)}</CardContent></Card>
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
                  <TableRow key={m.id}>
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
                    <TableCell className="text-right">{m.legacy_visit_count}</TableCell>
                    <TableCell className="text-right">{thb(m.legacy_total_spend)}</TableCell>
                    <TableCell>{m.legacy_last_visit_at ?? "-"}</TableCell>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button variant="outline" asChild>
              <a href="/members" onClick={(e) => e.preventDefault()}>
                <Download className="h-4 w-4 mr-2" />Template later
              </a>
            </Button>
            <Button onClick={doImport} disabled={importRows.length === 0 || importing}>
              {importing ? "Importing..." : "Import members"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
