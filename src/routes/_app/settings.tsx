import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Trash2, Plus, Printer, QrCode, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
// qrcode is dynamically imported inside QrCodesTab to avoid Node deps at SSR module-eval

export const Route = createFileRoute("/_app/settings")({ component: SettingsPage });

type RTable = { id: string; code: string; capacity: number };

type Menu = { id: string; category_id: string | null; name_th: string; name_en: string; name_my: string; price: number; cost: number; available: boolean };

function MarginIndicator({ price, cost }: { price: number; cost: number }) {
  const margin = price > 0 ? ((price - cost) / price) * 100 : 0;
  const clamped = Math.max(0, Math.min(100, margin));
  const barColor = margin > 50 ? "bg-green-500" : margin >= 30 ? "bg-yellow-500" : "bg-red-500";
  const textColor = margin > 50 ? "text-green-600" : margin >= 30 ? "text-yellow-600" : "text-red-600";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">Margin</span>
        <span className={`font-medium ${textColor}`}>{margin.toFixed(2)}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
type Category = { id: string; name_th: string; name_en: string; name_my: string };
type Settings = { restaurant_name: string; vat_mode: "inclusive" | "exclusive"; vat_rate: number; printer_counter_ip: string | null; printer_kitchen_ip: string | null; starting_cash: number };
type Staff = { id: string; name: string; role: "admin" | "manager" | "staff"; active: boolean };

function SettingsPage() {
  const { t } = useI18n();
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">{t("nav_settings")}</h1>
      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">{t("general")}</TabsTrigger>
          <TabsTrigger value="menu">{t("menu_management")}</TabsTrigger>
          <TabsTrigger value="printers">{t("printers")}</TabsTrigger>
          <TabsTrigger value="qr">{t("qr_codes")}</TabsTrigger>
          <TabsTrigger value="staff">{t("staff")}</TabsTrigger>
        </TabsList>
        <TabsContent value="general"><GeneralTab /></TabsContent>
        <TabsContent value="menu"><MenuTab /></TabsContent>
        <TabsContent value="printers"><PrintersTab /></TabsContent>
        <TabsContent value="qr"><QrCodesTab /></TabsContent>
        <TabsContent value="staff"><StaffTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function GeneralTab() {
  const { t } = useI18n();
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => { supabase.from("settings").select("*").eq("id", 1).single().then(({ data }) => setS(data as Settings)); }, []);
  if (!s) return null;
  const save = async () => {
    await supabase.from("settings").update(s).eq("id", 1);
    toast.success("Saved");
  };
  return (
    <Card className="max-w-xl mt-4">
      <CardContent className="space-y-4 pt-6">
        <div><Label>{t("restaurant_name")}</Label><Input value={s.restaurant_name} onChange={(e) => setS({ ...s, restaurant_name: e.target.value })} /></div>
        <div>
          <Label>{t("vat_mode")}</Label>
          <Select value={s.vat_mode} onValueChange={(v) => setS({ ...s, vat_mode: v as Settings["vat_mode"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="inclusive">{t("vat_inclusive")}</SelectItem>
              <SelectItem value="exclusive">{t("vat_exclusive")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>{t("vat_rate")}</Label><Input type="number" step="0.01" value={s.vat_rate} onChange={(e) => setS({ ...s, vat_rate: Number(e.target.value) })} /></div>
        <div>
          <Label>{t("starting_cash")}</Label>
          <Input type="number" step="1" value={s.starting_cash ?? 0} onChange={(e) => setS({ ...s, starting_cash: Number(e.target.value) })} />
          <p className="text-xs text-muted-foreground mt-1">{t("starting_cash_help")}</p>
        </div>
        <Button onClick={save}>{t("save")}</Button>
      </CardContent>
    </Card>
  );
}

function PrintersTab() {
  const { t } = useI18n();
  const [s, setS] = useState<Settings | null>(null);
  const [recentJob, setRecentJob] = useState<{ status: string; printed_at: string | null; created_at: string } | null>(null);

  useEffect(() => {
    supabase.from("settings").select("*").eq("id", 1).single().then(({ data }) => setS(data as Settings));
    supabase.from("print_jobs").select("status,printed_at,created_at").order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setRecentJob(data as typeof recentJob));
  }, []);

  if (!s) return null;
  const save = async () => {
    const { error } = await supabase.from("settings").update({ printer_counter_ip: s.printer_counter_ip, printer_kitchen_ip: s.printer_kitchen_ip }).eq("id", 1);
    if (error) { toast.error(`Save failed: ${error.message}`); return; }
    toast.success("Saved");
  };

  const sendTestPrint = async () => {
    await supabase.from("print_jobs").insert({
      printer: "counter",
      payload: { kind: "receipt", restaurant: "TEST PRINT", table: "T01", items: [{ name_en: "Test Item", qty: 1, unit_price: 99 }], total: 99, vatAmount: 0, vat_mode: "inclusive", payments: [{ method: "cash", amount: 99 }] },
    });
    toast.success("Test print job queued");
  };

  const bridgeAlive = recentJob && new Date(recentJob.printed_at ?? 0).getTime() > Date.now() - 60_000;

  return (
    <Card className="max-w-xl mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Printer className="h-4 w-4" /> Printer Settings — ESC/POS (port 9100)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>{t("printer_counter_ip")} — Receipt (Q80A)</Label>
          <Input placeholder="192.168.1.220" value={s.printer_counter_ip ?? ""} onChange={(e) => setS({ ...s, printer_counter_ip: e.target.value })} />
        </div>
        <div>
          <Label>{t("printer_kitchen_ip")} — Kitchen ticket</Label>
          <Input placeholder="192.168.1.221" value={s.printer_kitchen_ip ?? ""} onChange={(e) => setS({ ...s, printer_kitchen_ip: e.target.value })} />
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
          <div className="flex items-center gap-2 font-medium">
            {bridgeAlive
              ? <><Wifi className="h-4 w-4 text-green-500" /><span className="text-green-600">Print bridge online</span></>
              : <><WifiOff className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Print bridge not detected</span></>}
          </div>
          <p className="text-muted-foreground">
            Run the bridge on any device on the same LAN as the printer:
          </p>
          <code className="block bg-muted rounded px-2 py-1 text-xs select-all">
            npm run print-bridge
          </code>
        </div>

        <div className="flex gap-2">
          <Button onClick={save}>{t("save")}</Button>
          <Button variant="outline" onClick={sendTestPrint}>
            <Printer className="h-4 w-4 mr-2" /> Test print
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MenuTab() {
  const { t } = useI18n();
  const [menus, setMenus] = useState<Menu[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [edit, setEdit] = useState<Partial<Menu> | null>(null);

  const load = async () => {
    const { data: m } = await supabase.from("menus").select("*").order("sort");
    const { data: c } = await supabase.from("categories").select("*").order("sort");
    setMenus((m ?? []) as Menu[]); setCats((c ?? []) as Category[]);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!edit) return;
    const payload = {
      name_th: edit.name_th ?? "", name_en: edit.name_en ?? "", name_my: edit.name_my ?? "",
      price: Number(edit.price ?? 0), category_id: edit.category_id ?? null, available: edit.available ?? true,
    };
    if (edit.id) await supabase.from("menus").update(payload).eq("id", edit.id);
    else await supabase.from("menus").insert(payload);
    setEdit(null); load();
  };

  const toggleAvail = async (m: Menu) => {
    await supabase.from("menus").update({ available: !m.available }).eq("id", m.id);
    load();
  };

  const del = async (m: Menu) => {
    if (!confirm("Delete?")) return;
    await supabase.from("menus").delete().eq("id", m.id); load();
  };

  return (
    <div className="mt-4 space-y-4">
      <Button onClick={() => setEdit({})}><Plus className="h-4 w-4 mr-1" />{t("add")}</Button>
      <div className="grid gap-2">
        {menus.map((m) => (
          <Card key={m.id}>
            <CardContent className="py-3 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="font-medium">{m.name_th} · {m.name_en}</div>
                <div className="text-xs text-muted-foreground font-burmese">{m.name_my}</div>
              </div>
              <div className="w-40 text-right">
                <div className="font-bold">฿{Number(m.price).toFixed(2)}</div>
                <div className="text-xs text-muted-foreground">Cost ฿{Number(m.cost ?? 0).toFixed(2)}</div>
                <div className="mt-1"><MarginIndicator price={Number(m.price)} cost={Number(m.cost ?? 0)} /></div>
              </div>
              <Switch checked={m.available} onCheckedChange={() => toggleAvail(m)} />
              <Button variant="outline" size="sm" onClick={() => setEdit(m)}>{t("edit")}</Button>
              <Button variant="ghost" size="sm" onClick={() => del(m)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{edit?.id ? t("edit") : t("add")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>{t("name_th")}</Label><Input value={edit?.name_th ?? ""} onChange={(e) => setEdit({ ...edit, name_th: e.target.value })} /></div>
            <div><Label>{t("name_en")}</Label><Input value={edit?.name_en ?? ""} onChange={(e) => setEdit({ ...edit, name_en: e.target.value })} /></div>
            <div><Label>{t("name_my")}</Label><Input className="font-burmese" value={edit?.name_my ?? ""} onChange={(e) => setEdit({ ...edit, name_my: e.target.value })} /></div>
            <div><Label>{t("price")}</Label><Input type="number" step="0.01" value={edit?.price ?? 0} onChange={(e) => setEdit({ ...edit, price: Number(e.target.value) })} /></div>
            <div>
              <Label>{t("category")}</Label>
              <Select value={edit?.category_id ?? ""} onValueChange={(v) => setEdit({ ...edit, category_id: v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name_th} / {c.name_en}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2"><Switch checked={edit?.available ?? true} onCheckedChange={(v) => setEdit({ ...edit, available: v })} /><Label>{t("available_toggle")}</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>{t("cancel")}</Button>
            <Button onClick={save}>{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StaffTab() {
  const { t } = useI18n();
  const [list, setList] = useState<Staff[]>([]);
  const [add, setAdd] = useState(false);
  const [name, setName] = useState(""); const [role, setRole] = useState<Staff["role"]>("staff"); const [pin, setPin] = useState("");

  const load = async () => {
    const { data } = await supabase.rpc("list_staff");
    setList((data ?? []) as Staff[]);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name || pin.length < 4) { toast.error("Name and PIN required"); return; }
    const { error } = await supabase.rpc("create_staff", { _name: name, _role: role, _pin: pin });
    if (error) { toast.error(error.message); return; }
    setAdd(false); setName(""); setPin(""); setRole("staff"); load();
  };

  const del = async (s: Staff) => {
    if (!confirm(`Delete ${s.name}?`)) return;
    await supabase.rpc("delete_staff", { _id: s.id }); load();
  };

  return (
    <div className="mt-4 space-y-3">
      <Button onClick={() => setAdd(true)}><Plus className="h-4 w-4 mr-1" />{t("add")}</Button>
      <div className="grid gap-2">
        {list.map((s) => (
          <Card key={s.id}><CardContent className="py-3 flex items-center gap-4">
            <div className="flex-1"><div className="font-medium">{s.name}</div><div className="text-xs text-muted-foreground">{t(("role_"+s.role) as "role_admin")}</div></div>
            <Button variant="ghost" size="sm" onClick={() => del(s)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </CardContent></Card>
        ))}
      </div>
      <Dialog open={add} onOpenChange={setAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("add")} — {t("staff")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label>{t("role")}</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Staff["role"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t("role_admin")}</SelectItem>
                  <SelectItem value="manager">{t("role_manager")}</SelectItem>
                  <SelectItem value="staff">{t("role_staff")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>{t("pin_label")}</Label><Input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdd(false)}>{t("cancel")}</Button>
            <Button onClick={create}>{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function QrCodesTab() {
  const { t } = useI18n();
  const [tables, setTables] = useState<RTable[]>([]);
  const [qrs, setQrs] = useState<Record<string, string>>({});
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { default: QRCode } = await import("qrcode");
        const { data } = await supabase.from("restaurant_tables").select("id,code,capacity").order("code");
        const list = (data ?? []) as RTable[];
        if (cancelled) return;
        setTables(list);
        const entries = await Promise.allSettled(
          list.map(async (tbl) => {
            const url = `${baseUrl}/menu/${encodeURIComponent(tbl.code)}`;
            const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1 });
            return [tbl.id, dataUrl] as const;
          })
        );
        if (!cancelled) {
          const resolved = entries
            .filter((r): r is PromiseFulfilledResult<readonly [string, string]> => r.status === "fulfilled")
            .map((r) => r.value);
          setQrs(Object.fromEntries(resolved));
        }
      } catch (e) {
        console.error("QR generation error:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [baseUrl]);

  const printAll = () => {
    const html = `<html><head><title>QR Codes</title><style>
      body{font-family:sans-serif;margin:0;padding:16px}
      .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
      .card{border:1px solid #ddd;border-radius:12px;padding:16px;text-align:center;page-break-inside:avoid}
      .code{font-size:32px;font-weight:bold;margin-bottom:8px}
      .url{font-size:11px;color:#666;word-break:break-all;margin-top:8px}
      img{width:100%;max-width:280px;height:auto}
      @media print{.noprint{display:none}}
    </style></head><body>
      <div class="noprint" style="margin-bottom:16px"><button onclick="window.print()">Print</button></div>
      <div class="grid">
        ${tables.map((tbl) => `
          <div class="card">
            <div class="code">${t("table")} ${tbl.code}</div>
            <img src="${qrs[tbl.id] ?? ""}" alt="QR ${tbl.code}" />
            <div class="url">${baseUrl}/menu/${tbl.code}</div>
            <div style="font-size:12px;color:#666;margin-top:4px">สแกนเพื่อสั่งอาหาร · Scan to order</div>
          </div>
        `).join("")}
      </div>
    </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  const printOne = (tbl: RTable) => {
    const html = `<html><head><title>QR ${tbl.code}</title><style>
      body{font-family:sans-serif;text-align:center;padding:32px}
      .code{font-size:48px;font-weight:bold;margin-bottom:16px}
      img{width:320px;height:320px}
      .url{font-size:12px;color:#666;margin-top:12px;word-break:break-all}
      @media print{.noprint{display:none}}
    </style></head><body>
      <div class="noprint" style="margin-bottom:16px"><button onclick="window.print()">Print</button></div>
      <div class="code">${t("table")} ${tbl.code}</div>
      <img src="${qrs[tbl.id] ?? ""}" alt="QR" />
      <div style="font-size:14px;margin-top:16px">สแกนเพื่อสั่งอาหาร<br/>Scan to order</div>
      <div class="url">${baseUrl}/menu/${tbl.code}</div>
    </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("qr_help")}</p>
        <Button onClick={printAll} variant="outline"><Printer className="h-4 w-4 mr-1" />{t("print_all")}</Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {tables.map((tbl) => (
          <Card key={tbl.id}>
            <CardContent className="p-4 text-center space-y-2">
              <div className="font-bold text-lg">{t("table")} {tbl.code}</div>
              {qrs[tbl.id] ? (
                <img src={qrs[tbl.id]} alt={`QR ${tbl.code}`} className="w-full max-w-[180px] mx-auto" />
              ) : (
                <div className="aspect-square bg-muted rounded grid place-items-center"><QrCode className="h-8 w-8 text-muted-foreground" /></div>
              )}
              <div className="text-[10px] text-muted-foreground break-all">/menu/{tbl.code}</div>
              <Button size="sm" variant="outline" className="w-full" onClick={() => printOne(tbl)}><Printer className="h-3 w-3 mr-1" />{t("print")}</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
