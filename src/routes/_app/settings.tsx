import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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
import { Trash2, Plus, Printer, QrCode, Wifi, WifiOff, ChevronDown } from "lucide-react";
import { toast } from "sonner";
// qrcode is dynamically imported inside QrCodesTab to avoid Node deps at SSR module-eval

export const Route = createFileRoute("/_app/settings")({ component: SettingsPage });

type RTable = { id: string; code: string; capacity: number };

type Menu = { id: string; category_id: string | null; name_th: string; name_en: string; name_my: string; price: number; cost: number; available: boolean; image_url?: string | null };

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
// MenuIngredient as stored in state during editing (uses real DB column names: name_thai / name_english)
type MenuIngredientRow = {
  id?: string;           // undefined = newly added, not yet saved
  ingredient_id: string;
  name_thai: string;
  name_english: string | null;
  unit: string;
  cost_per_unit: number;
  quantity: number;
  _deleted?: boolean;    // marked for removal on save
};
type Settings = { restaurant_name: string; vat_mode: "inclusive" | "exclusive"; vat_rate: number; printer_counter_ip: string | null; printer_kitchen_ip: string | null; starting_cash: number };
type Staff = { id: string; name: string; role: "admin" | "manager" | "staff"; active: boolean };
// Add-ons
type AddonOption = { id?: string; name: string; price: number; _deleted?: boolean };
type AddonGroup = { id: string; name: string; kitchen_name: string | null; addon_options: AddonOption[] };
type EditAddonGroup = { id?: string; name: string; kitchen_name: string; options: AddonOption[] };

function SettingsPage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState("general");

  // Allow IngredientsSection to switch to the ingredients tab
  useEffect(() => {
    const handler = () => setActiveTab("ingredients");
    window.addEventListener("pos:open-ingredients-tab", handler);
    return () => window.removeEventListener("pos:open-ingredients-tab", handler);
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">{t("nav_settings")}</h1>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="general">{t("general")}</TabsTrigger>
          <TabsTrigger value="menu">{t("menu_management")}</TabsTrigger>
          <TabsTrigger value="ingredients">{t("ingredients")}</TabsTrigger>
          <TabsTrigger value="addons">{t("add_ons")}</TabsTrigger>
          <TabsTrigger value="printers">{t("printers")}</TabsTrigger>
          <TabsTrigger value="qr">{t("qr_codes")}</TabsTrigger>
          <TabsTrigger value="staff">{t("staff")}</TabsTrigger>
        </TabsList>
        <TabsContent value="general"><GeneralTab /></TabsContent>
        <TabsContent value="menu"><MenuTab /></TabsContent>
        <TabsContent value="ingredients"><IngredientsTab /></TabsContent>
        <TabsContent value="addons"><AddonsTab /></TabsContent>
        <TabsContent value="printers"><PrintersTab /></TabsContent>
        <TabsContent value="qr"><QrCodesTab /></TabsContent>
        <TabsContent value="staff"><StaffTab /></TabsContent>
      </Tabs>
    </div>
  );
}

type Ingredient = { id: string; name_thai: string; name_english: string | null; unit: string; cost_per_unit: number };
// ── Ingredients master list tab ───────────────────────────────────────────────
function IngredientsTab() {
  const [list, setList] = useState<Ingredient[]>([]);
  const [edit, setEdit] = useState<Partial<Ingredient> | null>(null);

  const load = async () => {
    const { data } = await supabase.from("ingredients").select("*").order("name_thai");
    setList((data ?? []) as Ingredient[]);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!edit) return;
    if (!edit.name_thai?.trim()) { toast.error("Thai name required"); return; }
    const payload = {
      name_thai: edit.name_thai.trim(),
      name_english: edit.name_english?.trim() || null,
      unit: (edit.unit ?? "").trim(),
      cost_per_unit: Number(edit.cost_per_unit ?? 0),
    };
    const { error } = edit.id
      ? await supabase.from("ingredients").update(payload).eq("id", edit.id)
      : await supabase.from("ingredients").insert(payload);
    if (error) { toast.error(error.message); return; }
    setEdit(null); load(); toast.success("Saved");
  };

  const del = async (i: Ingredient) => {
    if (!confirm(`Delete ${i.name_thai}?`)) return;
    const { error } = await supabase.from("ingredients").delete().eq("id", i.id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  return (
    <div className="mt-4 space-y-4">
      <Button onClick={() => setEdit({})}><Plus className="h-4 w-4 mr-1" />Add Ingredient</Button>
      <div className="grid gap-2">
        {list.map((i) => (
          <Card key={i.id}>
            <CardContent className="py-3 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="font-medium">{i.name_thai}</div>
                <div className="text-xs text-muted-foreground">{i.name_english ?? "—"}</div>
              </div>
              <div className="w-24 text-sm text-muted-foreground">{i.unit}</div>
              <div className="w-28 text-right font-bold">฿{Number(i.cost_per_unit).toFixed(2)}</div>
              <Button variant="outline" size="sm" onClick={() => setEdit(i)}>Edit</Button>
              <Button variant="ghost" size="sm" onClick={() => del(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </CardContent>
          </Card>
        ))}
        {list.length === 0 && <p className="text-sm text-muted-foreground">No ingredients yet.</p>}
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{edit?.id ? "Edit Ingredient" : "Add Ingredient"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Thai name *</Label><Input value={edit?.name_thai ?? ""} onChange={(e) => setEdit({ ...edit, name_thai: e.target.value })} /></div>
            <div><Label>English name</Label><Input value={edit?.name_english ?? ""} onChange={(e) => setEdit({ ...edit, name_english: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Unit</Label><Input placeholder="กก., กรัม, ลิตร, มล., ชิ้น" value={edit?.unit ?? ""} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} /></div>
              <div><Label>Cost per unit (฿)</Label><Input type="number" step="0.01" value={edit?.cost_per_unit ?? 0} onChange={(e) => setEdit({ ...edit, cost_per_unit: Number(e.target.value) })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

// ── Ingredients section inside the menu edit dialog ──────────────────────────
function IngredientsSection({
  menuId,
  rows,
  onChange,
}: {
  menuId: string | undefined;
  rows: MenuIngredientRow[];
  onChange: (rows: MenuIngredientRow[]) => void;
}) {
  const { t, lang } = useI18n();
  const [allIngredients, setAllIngredients] = useState<Ingredient[]>([]);
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [addQty, setAddQty] = useState("1");
  const [selectedIngredient, setSelectedIngredient] = useState<Ingredient | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load all ingredients for the picker
  useEffect(() => {
    supabase.from("ingredients").select("*").order("name_thai").then(({ data }: any) => {
      setAllIngredients((data ?? []) as Ingredient[]);
    });
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const visible = rows.filter((r) => !r._deleted);

  // Filtered ingredient list for dropdown (exclude already-added ones)
  const addedIds = new Set(visible.map((r) => r.ingredient_id));
  const filtered = allIngredients.filter(
    (ing) =>
      !addedIds.has(ing.id) &&
      (search === "" ||
        ing.name_thai.toLowerCase().includes(search.toLowerCase()) ||
        (ing.name_english ?? "").toLowerCase().includes(search.toLowerCase()))
  );

  const handleSelectIngredient = (ing: Ingredient) => {
    setSelectedIngredient(ing);
    setSearch(lang === "th" ? ing.name_thai : (ing.name_english ?? ing.name_thai));
    setShowDropdown(false);
  };

  const handleAdd = () => {
    if (!selectedIngredient) return;
    const qty = parseFloat(addQty) || 1;
    const newRow: MenuIngredientRow = {
      ingredient_id: selectedIngredient.id,
      name_thai: selectedIngredient.name_thai,
      name_english: selectedIngredient.name_english,
      unit: selectedIngredient.unit,
      cost_per_unit: selectedIngredient.cost_per_unit,
      quantity: qty,
    };
    onChange([...rows, newRow]);
    setSelectedIngredient(null);
    setSearch("");
    setAddQty("1");
  };

  const handleRemove = (idx: number) => {
    const target = visible[idx];
    if (target.id) {
      // existing DB row — mark deleted
      onChange(rows.map((r) => (r === target ? { ...r, _deleted: true } : r)));
    } else {
      // new row — just filter out
      onChange(rows.filter((r) => r !== target));
    }
  };

  const handleQtyChange = (idx: number, val: string) => {
    const target = visible[idx];
    const qty = parseFloat(val) || 0;
    onChange(rows.map((r) => (r === target ? { ...r, quantity: qty } : r)));
  };

  const totalCost = visible.reduce((s, r) => s + r.quantity * r.cost_per_unit, 0);

  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">{t("ingredients")}</Label>
        {visible.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {t("total_cost")}: ฿{totalCost.toFixed(2)}
          </span>
        )}
      </div>

      {/* Existing ingredient rows */}
      {visible.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("no_ingredients")}</p>
      ) : (
        <div className="space-y-2">
          {visible.map((row, idx) => (
            <div key={row.ingredient_id} className="flex items-center gap-2 text-sm">
              <div className="flex-1 min-w-0">
                <span className="font-medium">{lang === "th" ? row.name_thai : (row.name_english ?? row.name_thai)}</span>
                <span className="text-muted-foreground ml-1 text-xs">
                  ฿{Number(row.cost_per_unit).toFixed(2)}/{row.unit}
                </span>
              </div>
              <Input
                type="number"
                min="0"
                step="0.001"
                value={row.quantity}
                onChange={(e) => handleQtyChange(idx, e.target.value)}
                className="w-20 h-7 text-xs"
              />
              <span className="text-xs text-muted-foreground w-8">{row.unit}</span>
              <span className="text-xs w-16 text-right">
                ฿{(row.quantity * row.cost_per_unit).toFixed(2)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => handleRemove(idx)}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          ))}
          <div className="flex justify-end pt-1 border-t text-sm font-medium">
            <span>{t("total_cost")}: ฿{totalCost.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Add ingredient row */}
      <div className="flex items-start gap-2 pt-1 border-t">
        <div className="relative flex-1" ref={dropdownRef}>
          <div className="relative">
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSelectedIngredient(null); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              placeholder={t("select_ingredient")}
              className="h-8 text-xs pr-6"
            />
            <ChevronDown className="absolute right-2 top-2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
          {showDropdown && (
            <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-md max-h-44 overflow-y-auto text-sm">
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-muted-foreground text-xs">{t("no_data")}</div>
              ) : (
                filtered.map((ing) => (
                  <button
                    key={ing.id}
                    type="button"
                    className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center justify-between gap-2"
                    onMouseDown={(e) => { e.preventDefault(); handleSelectIngredient(ing); }}
                  >
                    <span>{lang === "th" ? ing.name_thai : (ing.name_english ?? ing.name_thai)}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      ฿{Number(ing.cost_per_unit).toFixed(2)}/{ing.unit}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <Input
          type="number"
          min="0"
          step="0.001"
          value={addQty}
          onChange={(e) => setAddQty(e.target.value)}
          placeholder={t("qty_label")}
          className="w-20 h-8 text-xs"
        />
        <Button
          size="sm"
          className="h-8 text-xs shrink-0"
          onClick={handleAdd}
          disabled={!selectedIngredient}
        >
          <Plus className="h-3 w-3 mr-1" />{t("add")}
        </Button>
      </div>

      {/* Link to manage ingredients master list */}
      <p className="text-[11px] text-muted-foreground">
        {t("manage_ingredients")}:{" "}
        <button
          type="button"
          className="underline hover:text-foreground"
          onClick={() => {
            // Open ingredients management tab — passed via custom event so MenuTab can hear it
            window.dispatchEvent(new CustomEvent("pos:open-ingredients-tab"));
          }}
        >
          {t("nav_settings")} → {t("ingredients")}
        </button>
      </p>
    </div>
  );
}

// ── Add-ons tab ───────────────────────────────────────────────────────────────
function AddonsTab() {
  const { t } = useI18n();
  const db = supabase as any;
  const [groups, setGroups] = useState<AddonGroup[]>([]);
  const [editGroup, setEditGroup] = useState<EditAddonGroup | null>(null);

  const load = async () => {
    const { data } = await db.from("addon_groups").select("*, addon_options(*)").order("name");
    setGroups((data ?? []) as AddonGroup[]);
  };
  useEffect(() => { load(); }, []);

  const openAdd = () => setEditGroup({ name: "", kitchen_name: "", options: [{ name: "", price: 0 }] });

  const openEdit = (g: AddonGroup) =>
    setEditGroup({
      id: g.id,
      name: g.name,
      kitchen_name: g.kitchen_name ?? "",
      options: g.addon_options.map((o) => ({ id: o.id, name: o.name, price: o.price })),
    });

  const saveGroup = async () => {
    if (!editGroup) return;
    if (!editGroup.name.trim()) { toast.error("Group name required"); return; }

    const groupPayload = {
      name: editGroup.name.trim(),
      kitchen_name: editGroup.kitchen_name.trim() || null,
    };

    let groupId = editGroup.id;
    if (groupId) {
      const { error } = await db.from("addon_groups").update(groupPayload).eq("id", groupId);
      if (error) { toast.error(error.message); return; }
    } else {
      const { data, error } = await db.from("addon_groups").insert(groupPayload).select("id").single();
      if (error) { toast.error(error.message); return; }
      groupId = data.id;
    }

    // Sync options: delete all existing then bulk-insert current list
    await db.from("addon_options").delete().eq("addon_group_id", groupId);
    const validOptions = editGroup.options.filter((o) => !o._deleted && o.name.trim());
    if (validOptions.length > 0) {
      const { error: optErr } = await db.from("addon_options").insert(
        validOptions.map((o) => ({
          addon_group_id: groupId,
          name: o.name.trim(),
          price: Number(o.price),
        }))
      );
      if (optErr) { toast.error(`Options: ${optErr.message}`); return; }
    }

    toast.success("Saved");
    setEditGroup(null);
    load();
  };

  const delGroup = async (g: AddonGroup) => {
    if (!confirm(`Delete "${g.name}" and all its options?`)) return;
    const { error } = await db.from("addon_groups").delete().eq("id", g.id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const setOpt = (idx: number, patch: Partial<AddonOption>) =>
    setEditGroup((prev) => prev ? {
      ...prev,
      options: prev.options.map((o, i) => i === idx ? { ...o, ...patch } : o),
    } : prev);

  const addOpt = () =>
    setEditGroup((prev) => prev ? { ...prev, options: [...prev.options, { name: "", price: 0 }] } : prev);

  const removeOpt = (idx: number) =>
    setEditGroup((prev) => {
      if (!prev) return prev;
      const opt = prev.options[idx];
      if (opt.id) {
        // existing row — mark deleted
        return { ...prev, options: prev.options.map((o, i) => i === idx ? { ...o, _deleted: true } : o) };
      }
      return { ...prev, options: prev.options.filter((_, i) => i !== idx) };
    });

  const visibleOpts = editGroup?.options.filter((o) => !o._deleted) ?? [];

  return (
    <div className="mt-4 space-y-4">
      <Button onClick={openAdd}><Plus className="h-4 w-4 mr-1" />{t("add_group")}</Button>
      <div className="grid gap-2">
        {groups.map((g) => (
          <Card key={g.id}>
            <CardContent className="py-3 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="font-medium">{g.name}</div>
                {g.kitchen_name && <div className="text-xs text-muted-foreground">Kitchen: {g.kitchen_name}</div>}
                <div className="text-xs text-muted-foreground mt-0.5">
                  {g.addon_options.length} {t("addon_options")}:&nbsp;
                  {g.addon_options.slice(0, 4).map((o) => o.name).join(", ")}
                  {g.addon_options.length > 4 ? "…" : ""}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => openEdit(g)}>{t("edit")}</Button>
              <Button variant="ghost" size="sm" onClick={() => delGroup(g)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </CardContent>
          </Card>
        ))}
        {groups.length === 0 && <p className="text-sm text-muted-foreground">{t("no_addon_groups")}</p>}
      </div>

      <Dialog open={!!editGroup} onOpenChange={(o) => !o && setEditGroup(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editGroup?.id ? t("edit") : t("add_group")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("addon_group_name")} *</Label>
              <Input
                value={editGroup?.name ?? ""}
                onChange={(e) => setEditGroup((p) => p ? { ...p, name: e.target.value } : p)}
              />
            </div>
            <div>
              <Label>{t("addon_kitchen_name")}</Label>
              <Input
                value={editGroup?.kitchen_name ?? ""}
                placeholder="e.g. ไม่เผ็ด / No spice"
                onChange={(e) => setEditGroup((p) => p ? { ...p, kitchen_name: e.target.value } : p)}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("addon_options")}</Label>
              {visibleOpts.map((opt, idx) => {
                // map visible idx back to real idx
                const realIdx = editGroup!.options.indexOf(opt);
                return (
                  <div key={realIdx} className="flex items-center gap-2">
                    <Input
                      value={opt.name}
                      onChange={(e) => setOpt(realIdx, { name: e.target.value })}
                      placeholder={t("option_name")}
                      className="flex-1 h-8 text-sm"
                    />
                    <span className="text-sm text-muted-foreground shrink-0">฿</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={opt.price}
                      onChange={(e) => setOpt(realIdx, { price: Number(e.target.value) })}
                      className="w-24 h-8 text-sm"
                    />
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeOpt(realIdx)}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                );
              })}
              <Button variant="outline" size="sm" onClick={addOpt} className="mt-1">
                <Plus className="h-3 w-3 mr-1" />{t("add_option")}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditGroup(null)}>{t("cancel")}</Button>
            <Button onClick={saveGroup}>{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Add-ons section inside the menu edit dialog ───────────────────────────────
function AddonsSection({
  allGroups,
  linkedIds,
  onChange,
}: {
  allGroups: AddonGroup[];
  linkedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
}) {
  const { t } = useI18n();
  if (allGroups.length === 0)
    return <p className="text-xs text-muted-foreground">{t("no_addon_groups")}</p>;

  const toggle = (id: string, checked: boolean) => {
    const next = new Set(linkedIds);
    checked ? next.add(id) : next.delete(id);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {allGroups.map((g) => (
        <div key={g.id} className="flex items-start gap-3">
          <Switch
            checked={linkedIds.has(g.id)}
            onCheckedChange={(v) => toggle(g.id, v)}
            className="mt-0.5"
          />
          <div className="min-w-0">
            <div className="text-sm font-medium leading-tight">{g.name}</div>
            {g.kitchen_name && (
              <div className="text-xs text-muted-foreground">Kitchen: {g.kitchen_name}</div>
            )}
            <div className="text-xs text-muted-foreground">
              {g.addon_options.map((o) => `${o.name} ฿${Number(o.price).toFixed(0)}`).join(" · ")}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── MenuTab ───────────────────────────────────────────────────────────────────
function MenuTab() {
  const { t } = useI18n();
  const [menus, setMenus] = useState<Menu[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [edit, setEdit] = useState<Partial<Menu> | null>(null);
  // Ingredient rows being edited for the current menu item
  const [editIngRows, setEditIngRows] = useState<MenuIngredientRow[]>([]);
  // All addon groups (for the AddonsSection picker)
  const [allAddonGroups, setAllAddonGroups] = useState<AddonGroup[]>([]);
  // IDs of addon groups currently linked to the menu item being edited
  const [linkedAddonIds, setLinkedAddonIds] = useState<Set<string>>(new Set());

  const db = supabase as any;

  const load = async () => {
    const { data: m } = await supabase.from("menus").select("*").order("sort");
    const { data: c } = await supabase.from("categories").select("*").order("sort");
    const { data: ag } = await db.from("addon_groups").select("*, addon_options(*)").order("name");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setMenus((m ?? []) as any as Menu[]); setCats((c ?? []) as Category[]);
    setAllAddonGroups((ag ?? []) as AddonGroup[]);
  };
  useEffect(() => { load(); }, []);

  // When opening edit for an existing menu item, load its ingredients + linked addons
  const openEdit = async (m: Partial<Menu>) => {
    setEdit(m);
    if (!m.id) { setEditIngRows([]); setLinkedAddonIds(new Set()); return; }
    // Load ingredients
    const { data: ingData } = await db
      .from("menu_ingredients")
      .select("id, ingredient_id, quantity, ingredients(id, name_thai, name_english, unit, cost_per_unit)")
      .eq("menu_id", m.id);
    const rows: MenuIngredientRow[] = (ingData ?? []).map((row: any) => ({
      id: row.id,
      ingredient_id: row.ingredient_id,
      quantity: row.quantity,
      name_thai: row.ingredients?.name_thai ?? "",
      name_english: row.ingredients?.name_english ?? null,
      unit: row.ingredients?.unit ?? "",
      cost_per_unit: row.ingredients?.cost_per_unit ?? 0,
    }));
    setEditIngRows(rows);
    // Load linked addon groups
    const { data: addonData } = await db
      .from("menu_addons")
      .select("addon_group_id")
      .eq("menu_id", m.id);
    setLinkedAddonIds(new Set((addonData ?? []).map((r: any) => r.addon_group_id)));
  };

  // Compute auto-derived cost from visible ingredient rows
  const derivedCost = editIngRows
    .filter((r) => !r._deleted)
    .reduce((s, r) => s + r.quantity * r.cost_per_unit, 0);

  // Keep edit.cost in sync whenever ingredient rows change
  useEffect(() => {
    if (edit) setEdit((prev) => prev ? { ...prev, cost: parseFloat(derivedCost.toFixed(2)) } : prev);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedCost]);

  const save = async () => {
    if (!edit) return;
    const payload = {
      name_th: edit.name_th ?? "", name_en: edit.name_en ?? "", name_my: edit.name_my ?? "",
      price: Number(edit.price ?? 0), cost: Number(edit.cost ?? 0),
      category_id: edit.category_id ?? null, available: edit.available ?? true,
    };
    let menuId = edit.id;
    if (menuId) {
      await db.from("menus").update(payload).eq("id", menuId);
    } else {
      const { data: inserted } = await db.from("menus").insert(payload).select("id").single();
      menuId = inserted?.id;
    }

    // Save ingredient rows
    if (menuId) {
      for (const row of editIngRows) {
        if (row._deleted && row.id) {
          await db.from("menu_ingredients").delete().eq("id", row.id);
        } else if (!row._deleted) {
          if (row.id) {
            await db.from("menu_ingredients").update({ quantity: row.quantity }).eq("id", row.id);
          } else {
            await db.from("menu_ingredients").insert({
              menu_id: menuId,
              ingredient_id: row.ingredient_id,
              quantity: row.quantity,
            });
          }
        }
      }
      // Sync menu_addons: replace all
      await db.from("menu_addons").delete().eq("menu_id", menuId);
      for (const groupId of linkedAddonIds) {
        await db.from("menu_addons").insert({ menu_id: menuId, addon_group_id: groupId });
      }
    }

    setEdit(null); setEditIngRows([]); setLinkedAddonIds(new Set()); load();
  };

  const closeEdit = () => { setEdit(null); setEditIngRows([]); setLinkedAddonIds(new Set()); };

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
      <Button onClick={() => openEdit({})}><Plus className="h-4 w-4 mr-1" />{t("add")}</Button>
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
              <Button variant="outline" size="sm" onClick={() => openEdit(m)}>{t("edit")}</Button>
              <Button variant="ghost" size="sm" onClick={() => del(m)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => !o && closeEdit()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{edit?.id ? t("edit") : t("add")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>{t("name_th")}</Label><Input value={edit?.name_th ?? ""} onChange={(e) => setEdit({ ...edit, name_th: e.target.value })} /></div>
            <div><Label>{t("name_en")}</Label><Input value={edit?.name_en ?? ""} onChange={(e) => setEdit({ ...edit, name_en: e.target.value })} /></div>
            <div><Label>{t("name_my")}</Label><Input className="font-burmese" value={edit?.name_my ?? ""} onChange={(e) => setEdit({ ...edit, name_my: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t("price")} (฿)</Label><Input type="number" step="0.01" value={edit?.price ?? 0} onChange={(e) => setEdit({ ...edit, price: Number(e.target.value) })} /></div>
              <div><Label>Cost (฿)</Label><Input type="number" step="0.01" value={edit?.cost ?? 0} onChange={(e) => setEdit({ ...edit, cost: Number(e.target.value) })} /></div>
            </div>
            <MarginIndicator price={Number(edit?.price ?? 0)} cost={Number(edit?.cost ?? 0)} />
            {/* ── Ingredients section ── */}
            <div className="border rounded-md p-3 bg-muted/30">
              <IngredientsSection
                menuId={edit?.id}
                rows={editIngRows}
                onChange={setEditIngRows}
              />
            </div>

            {/* ── Add-ons section ── */}
            <div className="border rounded-md p-3 bg-muted/30">
              <Label className="text-sm font-semibold mb-2 block">{t("linked_addons")}</Label>
              <AddonsSection
                allGroups={allAddonGroups}
                linkedIds={linkedAddonIds}
                onChange={setLinkedAddonIds}
              />
            </div>

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
            <Button variant="outline" onClick={closeEdit}>{t("cancel")}</Button>
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
