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
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/settings")({ component: SettingsPage });

type Menu = { id: string; category_id: string | null; name_th: string; name_en: string; name_my: string; price: number; available: boolean };
type Category = { id: string; name_th: string; name_en: string; name_my: string };
type Settings = { restaurant_name: string; vat_mode: "inclusive" | "exclusive"; vat_rate: number; printer_counter_ip: string | null; printer_kitchen_ip: string | null };
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
          <TabsTrigger value="staff">{t("staff")}</TabsTrigger>
        </TabsList>
        <TabsContent value="general"><GeneralTab /></TabsContent>
        <TabsContent value="menu"><MenuTab /></TabsContent>
        <TabsContent value="printers"><PrintersTab /></TabsContent>
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
        <Button onClick={save}>{t("save")}</Button>
      </CardContent>
    </Card>
  );
}

function PrintersTab() {
  const { t } = useI18n();
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => { supabase.from("settings").select("*").eq("id", 1).single().then(({ data }) => setS(data as Settings)); }, []);
  if (!s) return null;
  const save = async () => { await supabase.from("settings").update({ printer_counter_ip: s.printer_counter_ip, printer_kitchen_ip: s.printer_kitchen_ip }).eq("id", 1); toast.success("Saved"); };
  return (
    <Card className="max-w-xl mt-4">
      <CardContent className="space-y-4 pt-6">
        <div><Label>{t("printer_counter_ip")}</Label><Input placeholder="192.168.1.50" value={s.printer_counter_ip ?? ""} onChange={(e) => setS({ ...s, printer_counter_ip: e.target.value })} /></div>
        <div><Label>{t("printer_kitchen_ip")}</Label><Input placeholder="192.168.1.51" value={s.printer_kitchen_ip ?? ""} onChange={(e) => setS({ ...s, printer_kitchen_ip: e.target.value })} /></div>
        <p className="text-xs text-muted-foreground">Print jobs are queued in the database for a local print bridge to consume and forward to the Sunmi printers (kitchen tickets in Burmese).</p>
        <Button onClick={save}>{t("save")}</Button>
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
              <div className="font-bold w-24 text-right">฿{Number(m.price).toFixed(2)}</div>
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
