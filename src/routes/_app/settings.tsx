import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { escapeHtml } from "@/lib/escape-html";
import { useI18n } from "@/lib/i18n";
import { publicBaseUrl } from "@/lib/public-url";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeypadInput } from "@/components/KeypadInput";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Trash2, Plus, Printer, QrCode, Wifi, WifiOff, ChevronDown, LayoutGrid, Search, ImageIcon, Link2, ChevronRight, ChefHat } from "lucide-react";
import { toast } from "sonner";
import { makeDriver, printInDedicatedDocument, type DriverId } from "@/lib/print/PrintService";
import {
  canPrintDirect, getPrintTransport, setPrintTransport, type PrintTransport,
  getCounterLink, setCounterLink, type CounterLink, printDirect, probePrinter,
} from "@/lib/counter-printer";
import type { PrintJob } from "@/lib/print/types";
import { ReceiptPreview72, receiptToHtml } from "@/components/print/ReceiptPreview72";
import { KitchenTicketPreview72, kitchenToHtml } from "@/components/print/KitchenTicketPreview72";
import { sampleReceipt, sampleKitchen, sampleDepartmentOrder, splitOrderByDepartment } from "@/lib/print/sampleData";
import { parseBuckets, isValidBucket, type QrTimeBucket } from "@/lib/qr-buckets";
// qrcode is dynamically imported inside QrCodesTab to avoid Node deps at SSR module-eval

export const Route = createFileRoute("/_app/settings")({ component: SettingsPage });

type RTable = { id: string; code: string; capacity: number };

type Menu = {
  id: string;
  category_id: string | null;
  name_th: string;
  name_en: string;
  name_my: string;
  price: number;
  cost: number;
  available: boolean;
  image_url?: string | null;
  manager_menu_id?: string | null;
  is_set?: boolean;
  is_set_child?: boolean;
};

function MarginIndicator({ price, cost }: { price: number; cost: number }) {
  const { t } = useI18n();
  const margin = price > 0 ? ((price - cost) / price) * 100 : 0;
  const clamped = Math.max(0, Math.min(100, margin));
  const barColor = margin > 50 ? "bg-green-500" : margin >= 30 ? "bg-yellow-500" : "bg-red-500";
  const textColor = margin > 50 ? "text-green-600" : margin >= 30 ? "text-yellow-600" : "text-red-600";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{t("set_margin")}</span>
        <span className={`font-medium ${textColor}`}>{margin.toFixed(2)}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
type Category = { id: string; name_th: string; name_en: string; name_my: string; kitchen_zone_id?: string | null };
type KitchenZone = { id: string; name_th: string; name_en: string; sort: number; active: boolean; print_to_kitchen: boolean; counter_group: string };
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
type RoundingMode = "none" | "nearest_whole" | "up_whole" | "down_whole";
type Settings = {
  restaurant_name: string;
  address: string | null;
  receipt_promo: string | null;
  receipt_logo_url: string | null;
  vat_enabled: boolean;
  vat_mode: "inclusive" | "exclusive";
  vat_rate: number;
  service_fee_rate: number;
  rounding_mode: RoundingMode;
  max_discount_percent: number;
  gov_qr_enabled: boolean;
  gov_qr_label: string;
  gov_qr_customer_percent: number;
  gov_qr_government_percent: number;
  printer_counter_ip: string | null;
  printer_kitchen_ip: string | null;
  starting_cash: number;
  qr_time_buckets: QrTimeBucket[];
};
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
          <TabsTrigger value="kitchen-zones">{t("set_kitchen_zones")}</TabsTrigger>
          <TabsTrigger value="tables">{t("set_tables")}</TabsTrigger>
          <TabsTrigger value="printers">{t("printers")}</TabsTrigger>
          <TabsTrigger value="qr">{t("qr_codes")}</TabsTrigger>
          <TabsTrigger value="staff">{t("staff")}</TabsTrigger>
        </TabsList>
        <TabsContent value="general"><GeneralTab /></TabsContent>
        <TabsContent value="menu"><MenuTab /></TabsContent>
        <TabsContent value="ingredients"><IngredientsTab /></TabsContent>
        <TabsContent value="addons"><AddonsTab /></TabsContent>
        <TabsContent value="kitchen-zones"><KitchenZonesTab /></TabsContent>
        <TabsContent value="tables"><TablesTab /></TabsContent>
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
  const { t } = useI18n();
  const [list, setList] = useState<Ingredient[]>([]);
  const [edit, setEdit] = useState<Partial<Ingredient> | null>(null);

  const load = async () => {
    const { data } = await supabase.from("ingredients").select("*").order("name_thai");
    setList((data ?? []) as Ingredient[]);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!edit) return;
    if (!edit.name_thai?.trim()) { toast.error(t("set_thai_name_required")); return; }
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
    setEdit(null); load(); toast.success(t("saved"));
  };

  const del = async (i: Ingredient) => {
    if (!confirm(`${t("set_delete_q")}${i.name_thai}?`)) return;
    const { error } = await supabase.from("ingredients").delete().eq("id", i.id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  return (
    <div className="mt-4 space-y-4">
      <Button onClick={() => setEdit({})}><Plus className="h-4 w-4 mr-1" />{t("set_add_ingredient")}</Button>
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
              <Button variant="outline" size="sm" onClick={() => setEdit(i)}>{t("edit")}</Button>
              <Button variant="ghost" size="sm" onClick={() => del(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </CardContent>
          </Card>
        ))}
        {list.length === 0 && <p className="text-sm text-muted-foreground">{t("set_no_ingredients")}</p>}
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{edit?.id ? t("set_edit_ingredient") : t("set_add_ingredient")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>{t("set_thai_name_req")}</Label><Input value={edit?.name_thai ?? ""} onChange={(e) => setEdit({ ...edit, name_thai: e.target.value })} /></div>
            <div><Label>{t("set_english_name")}</Label><Input value={edit?.name_english ?? ""} onChange={(e) => setEdit({ ...edit, name_english: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t("set_unit")}</Label><Input placeholder="กก., กรัม, ลิตร, มล., ชิ้น" value={edit?.unit ?? ""} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} /></div>
              <div><Label>{t("set_cost_per_unit")}</Label><KeypadInput value={edit?.cost_per_unit ?? 0} onChange={(n) => setEdit({ ...edit, cost_per_unit: n })} title={t("set_cost_per_unit_title")} decimal /></div>
            </div>
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

function GeneralTab() {
  const { t } = useI18n();
  const [s, setS] = useState<Settings | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoFileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    supabase.from("settings").select("*").eq("id", 1).single().then(({ data }) => {
      if (!data) return;
      setS({ ...(data as unknown as Settings), qr_time_buckets: parseBuckets((data as any).qr_time_buckets) });
    });
  }, []);
  if (!s) return null;
  // Upload a logo file to the public-assets bucket and use its public URL.
  const uploadLogo = async (file: File) => {
    setUploadingLogo(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `receipt-logo-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("public-assets").upload(path, file, { cacheControl: "3600", upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("public-assets").getPublicUrl(path);
      setS((prev) => (prev ? { ...prev, receipt_logo_url: data.publicUrl } : prev));
      toast.success(t("set_logo_uploaded"));
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploadingLogo(false);
    }
  };
  const save = async () => {
    // Drop any half-filled time windows so the report/detail views stay clean.
    const cleaned: Settings = { ...s, qr_time_buckets: s.qr_time_buckets.filter(isValidBucket) };
    const { error } = await (supabase as any).from("settings").update(cleaned).eq("id", 1);
    if (error) { toast.error(error.message); return; }
    setS(cleaned);
    toast.success(t("saved"));
  };
  const previewSubtotal = sampleReceipt.subtotal;
  const previewService = previewSubtotal * Number(s.service_fee_rate ?? 0) / 100;
  const previewVatRate = Number(s.vat_rate ?? 0);
  const previewBase = previewSubtotal + previewService;
  const previewVat = s.vat_enabled
    ? s.vat_mode === "exclusive"
      ? previewBase * previewVatRate / 100
      : previewBase - previewBase / (1 + previewVatRate / 100)
    : 0;
  const previewTotal = s.vat_mode === "exclusive" ? previewBase + previewVat : previewBase;
  const receiptPreview = {
    ...sampleReceipt,
    restaurant: s.restaurant_name || sampleReceipt.restaurant,
    logoUrl: s.receipt_logo_url?.trim() || undefined,
    serviceCharge: previewService,
    vatMode: s.vat_mode,
    vatRate: previewVatRate,
    vatAmount: previewVat,
    total: previewTotal,
    payments: [{ method: s.gov_qr_enabled ? "gov_qr" : "cash", amount: previewTotal }],
    change: s.gov_qr_enabled ? 0 : Math.max(0, 1000 - previewTotal),
  };
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(20rem,28rem)_minmax(0,36rem)]">
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">{t("set_receipt_preview")}</CardTitle></CardHeader>
          <CardContent>
            <div className="rounded-lg border bg-muted/30 py-5">
              <ReceiptPreview72 data={receiptPreview} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">{t("set_store_info")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div><Label>{t("restaurant_name")}</Label><Input value={s.restaurant_name} onChange={(e) => setS({ ...s, restaurant_name: e.target.value })} /><p className="text-xs text-muted-foreground mt-1">Prints at the top of the receipt. You can use the Thai name.</p></div>
            <div><Label>{t("set_address")}</Label><Input value={s.address ?? ""} onChange={(e) => setS({ ...s, address: e.target.value })} placeholder="224/1 บางนา บางนาเหนือ กรุงเทพมหานคร 10260" /></div>
            <div><Label>{t("set_promo_line")}</Label><Input value={s.receipt_promo ?? ""} onChange={(e) => setS({ ...s, receipt_promo: e.target.value })} placeholder="สมาชิกรับฟรี! ครบ 500 …" /><p className="text-xs text-muted-foreground mt-1">{t("set_promo_help")}</p></div>
            <div>
              <Label>{t("starting_cash")}</Label>
              <KeypadInput value={s.starting_cash ?? 0} onChange={(n) => setS({ ...s, starting_cash: n })} title={t("starting_cash")} />
              <p className="text-xs text-muted-foreground mt-1">{t("starting_cash_help")}</p>
            </div>
            <Button onClick={save}>{t("save")}</Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("set_receipt_setup")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border p-3 space-y-2">
            <Label>{t("set_receipt_logo")}</Label>
            <input
              ref={logoFileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.currentTarget.value = ""; }}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => logoFileRef.current?.click()} disabled={uploadingLogo}>
                {uploadingLogo ? "Uploading…" : "Upload logo"}
              </Button>
              {s.receipt_logo_url && (
                <Button variant="outline" size="sm" onClick={() => setS({ ...s, receipt_logo_url: "" })}>
                  Clear logo
                </Button>
              )}
            </div>
            {s.receipt_logo_url && (
              <img src={s.receipt_logo_url} alt="Receipt logo" className="mt-1 max-h-16 rounded border bg-white p-1 object-contain" />
            )}
            <Input
              type="url"
              placeholder={t("set_logo_url_ph")}
              value={s.receipt_logo_url ?? ""}
              onChange={(e) => setS({ ...s, receipt_logo_url: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">Pick a PNG/JPG file, or paste a direct image URL. Wide transparent PNG works best.</p>
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label>{t("set_vat")}</Label>
                <p className="text-xs text-muted-foreground">Enable or hide VAT on bills and receipts.</p>
              </div>
              <Switch checked={s.vat_enabled} onCheckedChange={(checked) => setS({ ...s, vat_enabled: checked })} />
            </div>
            {s.vat_enabled && (
              <div className="grid grid-cols-2 gap-3">
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
                <div><Label>{t("vat_rate")}</Label><KeypadInput value={s.vat_rate} onChange={(n) => setS({ ...s, vat_rate: Math.min(100, n) })} title={t("vat_rate")} display={(n) => `${n}%`} decimal /></div>
              </div>
            )}
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <Label>{t("set_service_fee")}</Label>
            <div className="grid grid-cols-[1fr_9rem] gap-3 items-center">
              <span className="text-sm text-muted-foreground">{t("set_service_rate")}</span>
              <KeypadInput value={s.service_fee_rate ?? 0} onChange={(n) => setS({ ...s, service_fee_rate: Math.min(100, n) })} title={t("set_service_rate")} display={(n) => `${n}%`} decimal />
            </div>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <Label>{t("set_rounding")}</Label>
            <Select value={s.rounding_mode ?? "none"} onValueChange={(v) => setS({ ...s, rounding_mode: v as RoundingMode })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("set_no_rounding")}</SelectItem>
                <SelectItem value="nearest_whole">Round to nearest ฿1</SelectItem>
                <SelectItem value="up_whole">Round up to ฿1</SelectItem>
                <SelectItem value="down_whole">Round down to ฿1</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <Label>{t("set_using_discounts")}</Label>
            <div className="grid grid-cols-[1fr_9rem] gap-3 items-center">
              <span className="text-sm text-muted-foreground">Maximum discount per bill (%)</span>
              <KeypadInput
                value={s.max_discount_percent ?? 100}
                onChange={(n) => setS({ ...s, max_discount_percent: Math.min(100, n) })}
                title={t("set_max_discount")}
                display={(n) => `${n}%`}
                decimal
              />
            </div>
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label>{t("set_gov_qr")}</Label>
                <p className="text-xs text-muted-foreground">A named QR payment (e.g. 60/40). The cashier enters the amount the customer uses; the balance is paid by cash or card.</p>
              </div>
              <Switch checked={s.gov_qr_enabled ?? false} onCheckedChange={(checked) => setS({ ...s, gov_qr_enabled: checked })} />
            </div>
            {s.gov_qr_enabled && (
              <div className="sm:max-w-[12rem]">
                <Label>{t("lbl_label")}</Label>
                <Input value={s.gov_qr_label ?? "60/40"} onChange={(e) => setS({ ...s, gov_qr_label: e.target.value })} />
              </div>
            )}
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <div>
              <Label>{t("set_qr_by_time")}</Label>
              <p className="text-xs text-muted-foreground">Split the QR payment total into time windows on the QR detail page and the X/Z report. Add an optional label (e.g. "OPEN-23:00") to name each window.</p>
            </div>
            {s.qr_time_buckets.length > 0 && (
              <div className="space-y-2">
                {s.qr_time_buckets.map((b, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={b.start}
                      onChange={(e) => setS({ ...s, qr_time_buckets: s.qr_time_buckets.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })}
                      className="w-28 shrink-0"
                    />
                    <span className="text-muted-foreground">–</span>
                    <Input
                      type="time"
                      value={b.end}
                      onChange={(e) => setS({ ...s, qr_time_buckets: s.qr_time_buckets.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })}
                      className="w-28 shrink-0"
                    />
                    <Input
                      type="text"
                      placeholder={t("set_label_optional")}
                      value={b.label ?? ""}
                      onChange={(e) => setS({ ...s, qr_time_buckets: s.qr_time_buckets.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                      className="flex-1 min-w-0"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => setS({ ...s, qr_time_buckets: s.qr_time_buckets.filter((_, j) => j !== i) })}
                      aria-label="Remove time window"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setS({ ...s, qr_time_buckets: [...s.qr_time_buckets, { start: "", end: "" }] })}
            >
              <Plus className="h-4 w-4 mr-1" />Add time window
            </Button>
          </div>

          <Button onClick={save}>{t("save")}</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function PrintersTab() {
  const { t } = useI18n();
  const [s, setS] = useState<Settings | null>(null);
  const [recentJob, setRecentJob] = useState<{ status: string; printed_at: string | null; created_at: string } | null>(null);

  useEffect(() => {
    supabase.from("settings").select("*").eq("id", 1).single().then(({ data }) => setS(data as unknown as Settings));
    supabase.from("print_jobs").select("status,printed_at,created_at").order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setRecentJob(data as typeof recentJob));
  }, []);

  if (!s) return null;
  const save = async () => {
    const { error } = await supabase.from("settings").update({ printer_counter_ip: s.printer_counter_ip, printer_kitchen_ip: s.printer_kitchen_ip }).eq("id", 1);
    if (error) { toast.error(`Save failed: ${error.message}`); return; }
    toast.success(t("saved"));
  };

  const sendTestPrint = async () => {
    await supabase.from("print_jobs").insert({
      printer: "counter",
      payload: { kind: "receipt", restaurant: "TEST PRINT", table: "T01", items: [{ name_en: "Test Item", qty: 1, unit_price: 99 }], total: 99, vatAmount: 0, vat_mode: "inclusive", payments: [{ method: "cash", amount: 99 }] },
    });
    toast.success(t("set_test_queued"));
  };

  const bridgeAlive = recentJob && new Date(recentJob.printed_at ?? 0).getTime() > Date.now() - 60_000;

  return (
    <div className="space-y-4 mt-4">
      <Card className="max-w-xl">
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
                ? <><Wifi className="h-4 w-4 text-green-500" /><span className="text-green-600">{t("set_bridge_online")}</span></>
                : <><WifiOff className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">{t("set_bridge_offline")}</span></>}
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

      <DirectPrintCard />

      <BrowserPrintTestCard />
    </div>
  );
}

function KitchenZonesTab() {
  const { t, lang } = useI18n();
  const [zones, setZones] = useState<KitchenZone[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [edit, setEdit] = useState<Partial<KitchenZone> | null>(null);

  const load = async () => {
    const [{ data: z }, { data: c }] = await Promise.all([
      supabase.from("kitchen_zones").select("*").order("sort"),
      supabase.from("categories").select("id,name_th,name_en,name_my,sort,kitchen_zone_id").order("sort"),
    ]);
    setZones((z ?? []) as KitchenZone[]);
    setCats((c ?? []) as Category[]);
  };

  useEffect(() => { load(); }, []);

  const saveZone = async () => {
    if (!edit?.name_th?.trim() || !edit?.name_en?.trim()) {
      toast.error(t("set_zone_name_required"));
      return;
    }
    const payload = {
      name_th: edit.name_th.trim(),
      name_en: edit.name_en.trim(),
      sort: Number(edit.sort ?? zones.length * 10 + 10),
      active: edit.active ?? true,
      print_to_kitchen: edit.print_to_kitchen ?? true,
      counter_group: edit.counter_group ?? "food",
    };
    const { error } = edit.id
      ? await supabase.from("kitchen_zones").update(payload).eq("id", edit.id)
      : await supabase.from("kitchen_zones").insert(payload);
    if (error) { toast.error(error.message); return; }
    setEdit(null);
    await load();
    toast.success(t("saved"));
  };

  const deleteZone = async (zone: KitchenZone) => {
    if (!confirm(`Delete ${zone.name_en}? Categories assigned to it will become unassigned.`)) return;
    const { error } = await supabase.from("kitchen_zones").delete().eq("id", zone.id);
    if (error) { toast.error(error.message); return; }
    await load();
  };

  const assignCategory = async (categoryId: string, zoneId: string) => {
    const value = zoneId === "__none__" ? null : zoneId;
    const { error } = await supabase.from("categories").update({ kitchen_zone_id: value }).eq("id", categoryId);
    if (error) { toast.error(error.message); return; }
    setCats((prev) => prev.map((c) => c.id === categoryId ? { ...c, kitchen_zone_id: value } : c));
  };

  const zoneName = (z: KitchenZone) => lang === "th" ? z.name_th : z.name_en;
  const catName = (c: Category) => lang === "th" ? c.name_th : c.name_en;

  const kitchenZones = zones.filter((z) => z.print_to_kitchen);
  const frontZones = zones.filter((z) => !z.print_to_kitchen);
  const zoneRow = (zone: KitchenZone) => (
    <div key={zone.id} className="flex items-center gap-3 rounded-lg border p-3">
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate">{zoneName(zone)}</div>
        <div className="text-xs text-muted-foreground truncate">{zone.name_th} · {t("lbl_sort")} {zone.sort}</div>
      </div>
      <Button variant="outline" size="sm" onClick={() => setEdit(zone)}>{t("edit")}</Button>
      <Button variant="ghost" size="icon" onClick={() => deleteZone(zone)}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">🍳 Kitchen zones</CardTitle>
              <Button size="sm" onClick={() => setEdit({ active: true, print_to_kitchen: true, sort: zones.length * 10 + 10 })}>
                <Plus className="h-4 w-4 mr-1" />{t("set_add_zone")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Prints to the kitchen printer — each its own ticket — plus a copy on the counter FOOD ticket.</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {kitchenZones.length === 0 && <p className="text-sm text-muted-foreground">{t("set_no_zones")}</p>}
            {kitchenZones.map(zoneRow)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">🧾 Front zones</CardTitle>
              <Button size="sm" onClick={() => setEdit({ active: true, print_to_kitchen: false, sort: zones.length * 10 + 10 })}>
                <Plus className="h-4 w-4 mr-1" />{t("set_add_zone")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Counter only — each its own ticket (Rice, Drinks, Alcohol, …).</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {frontZones.length === 0 && <p className="text-sm text-muted-foreground">No front zones yet.</p>}
            {frontZones.map(zoneRow)}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{t("set_assign_zones")}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {cats.map((cat) => (
            <div key={cat.id} className="grid grid-cols-[1fr_14rem] gap-3 items-center rounded-lg border p-3">
              <div className="min-w-0">
                <div className="font-medium truncate">{catName(cat)}</div>
                <div className="text-xs text-muted-foreground truncate">{cat.name_th} · {cat.name_en}</div>
              </div>
              <Select value={cat.kitchen_zone_id ?? "__none__"} onValueChange={(v) => assignCategory(cat.id, v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("set_unassigned")}</SelectItem>
                  {zones.map((zone) => (
                    <SelectItem key={zone.id} value={zone.id}>{zoneName(zone)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!edit} onOpenChange={(open) => !open && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{edit?.id ? t("set_edit_zone") : t("set_add_zone_title")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>{t("set_thai_name")}</Label><Input value={edit?.name_th ?? ""} onChange={(e) => setEdit({ ...edit, name_th: e.target.value })} /></div>
            <div><Label>{t("set_english_name")}</Label><Input value={edit?.name_en ?? ""} onChange={(e) => setEdit({ ...edit, name_en: e.target.value })} /></div>
            <div><Label>{t("lbl_sort")}</Label><KeypadInput value={edit?.sort ?? 0} onChange={(n) => setEdit({ ...edit, sort: n })} title={t("lbl_sort")} display={(n) => String(n)} /></div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label>{t("active")}</Label>
              <Switch checked={edit?.active ?? true} onCheckedChange={(checked) => setEdit({ ...edit, active: checked })} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>{t("send_to_kitchen")}</Label>
                <p className="text-xs text-muted-foreground">{t("set_send_kitchen_help")}</p>
              </div>
              <Switch checked={edit?.print_to_kitchen ?? true} onCheckedChange={(checked) => setEdit({ ...edit, print_to_kitchen: checked })} />
            </div>
            <p className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
              <strong>On = Kitchen zone</strong> — prints its own kitchen ticket, and its food is also copied onto the counter FOOD ticket for the waitress.<br />
              <strong>Off = Front zone</strong> — prints only its own counter ticket (e.g. Rice, Drinks, Alcohol).
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>{t("cancel")}</Button>
            <Button onClick={saveZone}>{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Direct printing = the Android app composes ESC/POS (raster, so Thai + Burmese
// print) and writes straight to the printer over LAN/USB/SUNMI. No bridge machine.
// Only works inside the APK; a browser always falls back to the print_jobs queue.
function DirectPrintCard() {
  const { t } = useI18n();
  const [transport, setTransport] = useState<PrintTransport>(getPrintTransport());
  const [link, setLink] = useState<CounterLink>(getCounterLink());
  const [busy, setBusy] = useState<string | null>(null);
  const native = canPrintDirect();

  const chooseTransport = (direct: boolean) => {
    const next: PrintTransport = direct ? "direct" : "queue";
    setPrintTransport(next);
    setTransport(next);
  };
  const chooseLink = (usb: boolean) => {
    const next: CounterLink = usb ? "usb" : "network";
    setCounterLink(next);
    setLink(next);
  };

  const testCounter = async () => {
    setBusy("counter");
    try {
      await printDirect("counter", {
        kind: "receipt",
        restaurant: "ล้นหม้อ · LONMOH",
        table: "TEST",
        items: [{ name_th: "ผัดไทยกุ้งสด", name_en: "Pad Thai", qty: 1, unit_price: 120 }],
        total: 120,
        payments: [{ method: "cash", amount: 120 }],
      });
      toast.success("Test receipt sent ✓");
    } catch (e: any) {
      toast.error(e?.message ?? "Print failed");
    } finally {
      setBusy(null);
    }
  };

  const testKitchen = async () => {
    setBusy("kitchen");
    try {
      await printDirect("kitchen", {
        kind: "order_ticket",
        table: "TEST",
        order_type: "new",
        source: "pos",
        sent_at: new Date().toISOString(),
        lines: [{ qty: 2, name_th: "ผัดกะเพราหมู", name_my: "ဝက်သားနှင့်ကြက်သွန်ဖြူကြော်", name_en: "Basil Pork" }],
      });
      toast.success("Test kitchen ticket (TH + MY) sent ✓");
    } catch (e: any) {
      toast.error(e?.message ?? "Print failed");
    } finally {
      setBusy(null);
    }
  };

  const probe = async (printer: "counter" | "kitchen") => {
    setBusy(`probe-${printer}`);
    try {
      const r = await probePrinter(printer);
      if (r.reachable) toast.success(`${printer} printer reachable ✓`);
      else toast.error(`${printer}: ${r.error ?? "unreachable"}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Probe failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Printer className="h-4 w-4" /> Direct printing (this device)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!native && (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            Direct printing runs only inside the LONMOH POS Android app. In a browser, jobs go to the print queue.
          </div>
        )}
        <div className="flex items-center justify-between">
          <div>
            <Label>Print directly from this device</Label>
            <p className="text-xs text-muted-foreground">Off = queue jobs for the bridge (default).</p>
          </div>
          <Switch checked={transport === "direct"} onCheckedChange={chooseTransport} disabled={!native} />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <Label>Counter printer over USB</Label>
            <p className="text-xs text-muted-foreground">Off = LAN (recommended). On = USB cable to this tablet.</p>
          </div>
          <Switch checked={link === "usb"} onCheckedChange={chooseLink} disabled={!native} />
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={testCounter} disabled={!native || !!busy}>
            <Printer className="h-4 w-4 mr-2" /> Test receipt
          </Button>
          <Button variant="outline" size="sm" onClick={testKitchen} disabled={!native || !!busy}>
            <Printer className="h-4 w-4 mr-2" /> Test kitchen (TH+MY)
          </Button>
          <Button variant="ghost" size="sm" onClick={() => probe("counter")} disabled={!native || !!busy}>
            Probe counter
          </Button>
          <Button variant="ghost" size="sm" onClick={() => probe("kitchen")} disabled={!native || !!busy}>
            Probe kitchen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function BrowserPrintTestCard() {
  const { t } = useI18n();
  const [driver, setDriver] = useState<DriverId>("browser");
  const [preview, setPreview] = useState<null | "receipt" | "kitchen">(null);
  const [splitPreview, setSplitPreview] = useState(false);
  const nav = useNavigate();

  const splitTickets = splitOrderByDepartment(sampleDepartmentOrder);

  const renderHtml = (job: PrintJob) =>
    job.kind === "receipt" ? receiptToHtml(job.data) : kitchenToHtml(job.data);

  // SUNMI Android Chrome captures the current page DOM when window.print() is
  // called — even from a hidden iframe. Test buttons now NAVIGATE to a
  // dedicated print-only route (/print-test/...) so window.print() only sees
  // the receipt/ticket content.
  const openTest = (
    kind: "receipt" | "kitchen-ticket" | "department-split",
    mode: string,
  ) => {
    try {
      if (driver !== "browser") {
        const drv = makeDriver(driver, renderHtml);
        const job: PrintJob = kind === "receipt"
          ? { kind: "receipt", target: "counter", data: sampleReceipt }
          : { kind: "kitchen_ticket", target: "kitchen", data: sampleKitchen };
        void drv.print(job);
        return;
      }
      nav({
        to: "/print-test/$kind",
        params: { kind },
        search: { mode, auto: false },
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const run = (kind: "receipt" | "kitchen_ticket") =>
    openTest(
      kind === "receipt" ? "receipt" : "kitchen-ticket",
      kind === "receipt" ? "counter-test" : "kitchen-test",
    );

  const runSplit = () => openTest("department-split", "test");
  const printAllSplit = () => openTest("department-split", "test");


  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Printer className="h-4 w-4" /> Browser Print Test (Phase 1)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>{t("set_driver")}</Label>
          <Select value={driver} onValueChange={(v) => setDriver(v as DriverId)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="browser">Browser (window.print)</SelectItem>
              <SelectItem value="queue">Queue (print_jobs) — stub</SelectItem>
              <SelectItem value="android">Android bridge — stub</SelectItem>
              <SelectItem value="network">Network ESC/POS — stub</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            Only the Browser driver is implemented in Phase 1. Other drivers will throw.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => setPreview("receipt")}>Preview Counter Receipt (72mm)</Button>
          <Button variant="outline" onClick={() => setPreview("kitchen")}>Preview Kitchen Ticket (72mm)</Button>
          <Button onClick={() => run("receipt")}>
            <Printer className="h-4 w-4 mr-2" /> Test Counter Receipt
          </Button>
          <Button onClick={() => run("kitchen_ticket")}>
            <Printer className="h-4 w-4 mr-2" /> Test Kitchen Ticket
          </Button>
          <Button variant="outline" onClick={() => setSplitPreview(true)}>
            Preview Department Split Tickets
          </Button>
          <Button onClick={runSplit}>
            <Printer className="h-4 w-4 mr-2" /> Test Department Split Tickets
          </Button>
        </div>

        <p className="text-xs text-muted-foreground border-l-2 border-primary/40 pl-2">
          For Chrome print preview, choose the thermal printer and set paper size to 72mm/80mm if available.
        </p>
        <p className="text-xs text-muted-foreground border-l-2 border-amber-500/60 pl-2">
          Desktop PDF preview may show the receipt on A4. On SUNMI/thermal printer, choose the 72mm/80mm paper size if available.
        </p>
        <p className="text-xs text-muted-foreground border-l-2 border-blue-500/60 pl-2">
          "Test Department Split Tickets" opens one browser print dialog per department in sequence. This simulates the future Android/Network bridge that will dispatch one job per station printer.
        </p>

        <Dialog open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {preview === "receipt" ? "Counter Receipt — 72mm preview" : "Kitchen Ticket — 72mm preview"}
              </DialogTitle>
            </DialogHeader>
            <div className="bg-muted/30 p-3 rounded max-h-[60vh] overflow-auto">
              {preview === "receipt" && <ReceiptPreview72 data={sampleReceipt} />}
              {preview === "kitchen" && <KitchenTicketPreview72 data={sampleKitchen} />}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Shown at actual 72mm width. Desktop PDF preview may still render on A4 — pick a 72mm/80mm paper size on a thermal printer.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPreview(null)}>{t("close")}</Button>
              <Button
                onClick={async () => {
                  const kind = preview === "receipt" ? "receipt" : "kitchen_ticket";
                  setPreview(null);
                  await new Promise((r) => setTimeout(r, 100));
                  await run(kind);
                }}
              >
                <Printer className="h-4 w-4 mr-2" /> Print
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={splitPreview} onOpenChange={setSplitPreview}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                Department Split Tickets — Table {sampleDepartmentOrder.table} · {sampleDepartmentOrder.orderNo}
              </DialogTitle>
            </DialogHeader>
            <div className="bg-muted/30 p-3 rounded max-h-[65vh] overflow-auto flex flex-col items-center gap-6">
              {splitTickets.map((t, i) => (
                <div key={i} className="flex flex-col items-center gap-2 w-full">
                  <div className="print:hidden text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {t.department} — Ticket {t.ticketIndex}/{t.ticketTotal}
                  </div>
                  <div className="border border-dashed border-border bg-white p-2 rounded">
                    <KitchenTicketPreview72 data={t} />
                  </div>
                  {i < splitTickets.length - 1 && (
                    <div className="print:hidden w-full border-t border-dashed border-border mt-2" />
                  )}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              All {splitTickets.length} department tickets stacked for inspection. "Print All" sends them as one browser print job with page breaks between tickets, so the thermal printer cuts/separates per ticket. Labels above each ticket are hidden during print.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSplitPreview(false)}>{t("close")}</Button>
              <Button
                onClick={async () => {
                  setSplitPreview(false);
                  await new Promise((r) => setTimeout(r, 100));
                  await printAllSplit();
                }}
              >
                <Printer className="h-4 w-4 mr-2" /> Print All ({splitTickets.length})
              </Button>
            </div>
          </DialogContent>
        </Dialog>
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
    if (!editGroup.name.trim()) { toast.error(t("set_group_name_required")); return; }

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

    toast.success(t("saved"));
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
                    <KeypadInput
                      value={opt.price}
                      onChange={(n) => setOpt(realIdx, { price: n })}
                      title={t("lbl_price")}
                      display={(n) => String(n)}
                      decimal
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
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState("available");

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
      .select("group_id")
      .eq("menu_id", m.id);
    setLinkedAddonIds(new Set((addonData ?? []).map((r: any) => r.group_id)));
  };

  // Compute auto-derived cost from visible ingredient rows
  const derivedCost = editIngRows
    .filter((r) => !r._deleted)
    .reduce((s, r) => s + r.quantity * r.cost_per_unit, 0);

  // Keep edit.cost in sync whenever ingredient rows change
  useEffect(() => {
    if (edit && editIngRows.some((row) => !row._deleted)) {
      setEdit((prev) => prev ? { ...prev, cost: parseFloat(derivedCost.toFixed(2)) } : prev);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedCost]);

  const save = async () => {
    if (!edit) return;
    const payload = {
      name_th: edit.name_th ?? "", name_en: edit.name_en ?? "", name_my: edit.name_my ?? "",
      price: Number(edit.price ?? 0), cost: Number(edit.cost ?? 0),
      category_id: edit.category_id ?? null, available: edit.available ?? true,
      image_url: edit.image_url?.trim() || null,
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
        await db.from("menu_addons").insert({ menu_id: menuId, group_id: groupId });
      }
    }

    setEdit(null); setEditIngRows([]); setLinkedAddonIds(new Set());
    await load();
    toast.success(t("saved"));
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

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredMenus = menus.filter((menu) => {
    const matchesQuery = !normalizedQuery || [menu.name_th, menu.name_en, menu.name_my]
      .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
    const matchesCategory = categoryFilter === "all" || menu.category_id === categoryFilter;
    const matchesAvailability = availabilityFilter === "all"
      || (availabilityFilter === "available" ? menu.available : !menu.available);
    return matchesQuery && matchesCategory && matchesAvailability;
  });
  const categoryById = new Map(cats.map((category) => [category.id, category]));

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Thai, English, or Burmese"
            className="pl-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full xl:w-64"><SelectValue placeholder="All categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {cats.map((category) => <SelectItem key={category.id} value={category.id}>{category.name_th}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={availabilityFilter} onValueChange={setAvailabilityFilter}>
          <SelectTrigger className="w-full xl:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="unavailable">Unavailable</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => openEdit({ available: true })}><Plus className="h-4 w-4 mr-1" />{t("add")}</Button>
      </div>

      <div className="overflow-x-auto rounded-md border bg-background">
        <div className="grid min-w-[900px] grid-cols-[56px_minmax(240px,1fr)_180px_110px_110px_70px_40px] items-center gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
          <span>Image</span><span>Menu</span><span>Category</span><span className="text-right">Price</span><span className="text-right">Food cost</span><span className="text-center">Sale</span><span />
        </div>
        {filteredMenus.map((m) => {
          const category = m.category_id ? categoryById.get(m.category_id) : null;
          return (
            <button
              type="button"
              key={m.id}
              onClick={() => openEdit(m)}
              className="grid w-full min-w-[900px] grid-cols-[56px_minmax(240px,1fr)_180px_110px_110px_70px_40px] items-center gap-3 border-b px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            >
              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded border bg-muted">
                {m.image_url ? <img src={m.image_url} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-5 w-5 text-muted-foreground" />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{m.name_th}</span>
                  {m.manager_menu_id && <span className="inline-flex shrink-0 items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700"><Link2 className="h-3 w-3" />Manager</span>}
                  {m.is_set && <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">SET</span>}
                </div>
                <div className="truncate text-xs text-muted-foreground">{m.name_en || "English name missing"}</div>
                <div className="truncate text-xs text-muted-foreground font-burmese">{m.name_my || "Burmese kitchen name missing"}</div>
              </div>
              <div className="truncate text-sm text-muted-foreground">{category?.name_th ?? "Uncategorized"}</div>
              <div className="text-right font-semibold">฿{Number(m.price).toFixed(2)}</div>
              <div className="text-right">
                <div className="font-medium">฿{Number(m.cost ?? 0).toFixed(2)}</div>
                <div className="text-xs text-muted-foreground">{Number(m.price) > 0 ? `${((Number(m.cost ?? 0) / Number(m.price)) * 100).toFixed(1)}%` : "—"}</div>
              </div>
              <div className="flex justify-center" onClick={(event) => event.stopPropagation()}>
                <Switch checked={m.available} onCheckedChange={() => toggleAvail(m)} />
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          );
        })}
        {filteredMenus.length === 0 && <div className="px-4 py-12 text-center text-sm text-muted-foreground">No menus match these filters.</div>}
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => !o && closeEdit()}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{edit?.id ? "Menu details" : "Add menu"}</DialogTitle>
            {edit?.manager_menu_id && (
              <div className="flex items-center gap-2 text-sm text-sky-700">
                <Link2 className="h-4 w-4" />Linked to Manager · catalog fields may be refreshed by the next Manager publish
              </div>
            )}
          </DialogHeader>
          <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
            <div className="space-y-3">
              <div className="aspect-square overflow-hidden rounded-md border bg-muted">
                {edit?.image_url ? <img src={edit.image_url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center"><ImageIcon className="h-12 w-12 text-muted-foreground" /></div>}
              </div>
              <div><Label>Image URL</Label><Input value={edit?.image_url ?? ""} onChange={(e) => setEdit({ ...edit, image_url: e.target.value })} placeholder="https://…" /></div>
              <div className="rounded-md border p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><ChefHat className="h-4 w-4" />Kitchen display</div>
                <div className="text-sm font-burmese">{edit?.name_my || "Burmese kitchen name missing"}</div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div><Label>{t("name_th")}</Label><Input value={edit?.name_th ?? ""} onChange={(e) => setEdit({ ...edit, name_th: e.target.value })} /></div>
                <div><Label>{t("name_en")}</Label><Input value={edit?.name_en ?? ""} onChange={(e) => setEdit({ ...edit, name_en: e.target.value })} /></div>
              </div>
              <div><Label>{t("name_my")} · kitchen</Label><Input className="font-burmese" value={edit?.name_my ?? ""} onChange={(e) => setEdit({ ...edit, name_my: e.target.value })} /></div>
              <div>
                <Label>{t("category")}</Label>
                <Select value={edit?.category_id ?? ""} onValueChange={(v) => setEdit({ ...edit, category_id: v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name_th} / {c.name_en}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>{t("price")} (฿)</Label><KeypadInput value={edit?.price ?? 0} onChange={(n) => setEdit({ ...edit, price: n })} title={t("price")} decimal /></div>
                <div><Label>{t("lbl_cost")} (฿)</Label><KeypadInput value={edit?.cost ?? 0} onChange={(n) => setEdit({ ...edit, cost: n })} title={t("lbl_cost")} decimal /></div>
              </div>
              <MarginIndicator price={Number(edit?.price ?? 0)} cost={Number(edit?.cost ?? 0)} />
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div><div className="text-sm font-medium">Available for sale</div><div className="text-xs text-muted-foreground">Shown on POS and customer ordering menus</div></div>
                <Switch checked={edit?.available ?? true} onCheckedChange={(v) => setEdit({ ...edit, available: v })} />
              </div>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {/* ── Ingredients section ── */}
            <div className="border rounded-md p-4 bg-muted/20">
              <IngredientsSection
                menuId={edit?.id}
                rows={editIngRows}
                onChange={setEditIngRows}
              />
            </div>

            {/* ── Add-ons section ── */}
            <div className="border rounded-md p-4 bg-muted/20">
              <Label className="text-sm font-semibold mb-2 block">{t("linked_addons")}</Label>
              <AddonsSection
                allGroups={allAddonGroups}
                linkedIds={linkedAddonIds}
                onChange={setLinkedAddonIds}
              />
            </div>

          </div>
          <DialogFooter>
            {edit?.id && <Button variant="ghost" className="mr-auto text-destructive" onClick={() => { const current = edit as Menu; closeEdit(); void del(current); }}><Trash2 className="mr-2 h-4 w-4" />Delete menu</Button>}
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
  const [adminPin, setAdminPin] = useState("");

  const load = async () => {
    const { data } = await supabase.rpc("list_staff");
    setList((data ?? []) as Staff[]);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name || pin.length < 4) { toast.error(t("set_name_pin_required")); return; }
    if (adminPin.length < 4) { toast.error("Admin PIN required"); return; }
    const { error } = await supabase.rpc("create_staff", { _name: name, _role: role, _pin: pin, _admin_pin: adminPin });
    if (error) { toast.error(error.message); return; }
    setAdd(false); setName(""); setPin(""); setAdminPin(""); setRole("staff"); load();
  };

  const del = async (s: Staff) => {
    if (!confirm(`Delete ${s.name}?`)) return;
    const ap = window.prompt("Admin PIN") ?? "";
    if (ap.length < 4) { toast.error("Admin PIN required"); return; }
    const { error } = await supabase.rpc("delete_staff", { _id: s.id, _admin_pin: ap });
    if (error) { toast.error(error.message); return; }
    load();
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
            <div><Label>{t("col_name")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
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
            <div><Label>Admin PIN</Label><Input type="password" inputMode="numeric" maxLength={6} value={adminPin} onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, ""))} /></div>
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

// Owner-editable table list: seat capacity, add / rename / delete. Writes go
// through the logged-in admin session (RLS), so no code change needed to adjust.
function TablesTab() {
  const { t } = useI18n();
  type Row = { id: string; code: string; capacity: number; is_test: boolean };
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data } = await supabase.from("restaurant_tables").select("id,code,capacity,is_test").order("code");
    setRows(((data ?? []) as { id: string; code: string; capacity: number | null; is_test: boolean | null }[]).map((r) => ({
      id: r.id, code: r.code, capacity: r.capacity ?? 0, is_test: r.is_test ?? false,
    })));
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const setRow = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const saveAll = async () => {
    setSaving(true);
    try {
      for (const r of rows) {
        const code = r.code.trim();
        if (!code) continue;
        const { error } = await supabase.from("restaurant_tables").update({ code, capacity: r.capacity }).eq("id", r.id);
        if (error) throw error;
      }
      toast.success(t("saved"));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const addTable = async () => {
    const nums = rows.map((r) => { const m = /^T(\d+)$/.exec(r.code); return m ? Number(m[1]) : 0; });
    const next = String(Math.max(0, ...nums) + 1).padStart(2, "0");
    const { error } = await supabase.from("restaurant_tables").insert({ code: `T${next}`, capacity: 4 });
    if (error) { toast.error(error.message); return; }
    await load();
  };

  const removeTable = async (r: Row) => {
    if (!window.confirm(`${t("tbl_delete_confirm")} ${r.code}`)) return;
    const { error } = await supabase.from("restaurant_tables").delete().eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    setRows((rs) => rs.filter((x) => x.id !== r.id));
    toast.success(t("saved"));
  };

  if (loading) return null;

  return (
    <div className="space-y-4 mt-4">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LayoutGrid className="h-4 w-4" /> {t("set_tables")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-[1fr_7rem_2.5rem] items-center gap-2 px-1 text-xs text-muted-foreground">
            <div>{t("tbl_code")}</div>
            <div className="text-center">{t("tbl_seats")}</div>
            <div />
          </div>
          {rows.map((r) => (
            <div key={r.id} className="grid grid-cols-[1fr_7rem_2.5rem] items-center gap-2">
              <div className="flex items-center gap-2">
                <Input value={r.code} onChange={(e) => setRow(r.id, { code: e.target.value })} className="max-w-32" />
                {r.is_test && <span className="rounded bg-black px-1.5 py-0.5 text-[10px] text-white">{t("tbl_is_test")}</span>}
              </div>
              <KeypadInput
                value={r.capacity}
                onChange={(n) => setRow(r.id, { capacity: Math.max(0, Math.floor(n)) })}
                title={`${t("tbl_seats")} — ${r.code}`}
                display={(n) => String(n)}
              />
              <Button variant="ghost" size="icon" onClick={() => removeTable(r)} aria-label="delete">
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={addTable}><Plus className="mr-1 h-4 w-4" />{t("tbl_add")}</Button>
            <Button onClick={saveAll} disabled={saving}>{saving ? "…" : t("save")}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function QrCodesTab() {
  const { t } = useI18n();
  const [tables, setTables] = useState<RTable[]>([]);
  const [qrs, setQrs] = useState<Record<string, string>>({});
  const baseUrl = publicBaseUrl();

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
            <div class="code">${t("table")} ${escapeHtml(tbl.code)}</div>
            <img src="${qrs[tbl.id] ?? ""}" alt="QR ${escapeHtml(tbl.code)}" />
            <div class="url">${escapeHtml(baseUrl)}/menu/${escapeHtml(tbl.code)}</div>
            <div style="font-size:12px;color:#666;margin-top:4px">สแกนเพื่อสั่งอาหาร · Scan to order</div>
          </div>
        `).join("")}
      </div>
    </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  const printOne = (tbl: RTable) => {
    const html = `<html><head><title>QR ${escapeHtml(tbl.code)}</title><style>
      body{font-family:sans-serif;text-align:center;padding:32px}
      .code{font-size:48px;font-weight:bold;margin-bottom:16px}
      img{width:320px;height:320px}
      .url{font-size:12px;color:#666;margin-top:12px;word-break:break-all}
      @media print{.noprint{display:none}}
    </style></head><body>
      <div class="noprint" style="margin-bottom:16px"><button onclick="window.print()">Print</button></div>
      <div class="code">${t("table")} ${escapeHtml(tbl.code)}</div>
      <img src="${qrs[tbl.id] ?? ""}" alt="QR" />
      <div style="font-size:14px;margin-top:16px">สแกนเพื่อสั่งอาหาร<br/>Scan to order</div>
      <div class="url">${escapeHtml(baseUrl)}/menu/${escapeHtml(tbl.code)}</div>
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
