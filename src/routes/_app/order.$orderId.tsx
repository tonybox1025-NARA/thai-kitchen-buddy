import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n, pickName } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { thb } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Minus, Trash2, ChefHat, Receipt, ArrowLeft, AlertTriangle, ArrowLeftRight, X, Printer, Eye, Layers, Bell } from "lucide-react";
import { ManagerPinDialog } from "@/components/ManagerPinDialog";
import { SetMenuDialog } from "@/components/SetMenuDialog";
import { SETS, type SetConfig } from "@/lib/set-menu";
import { printCounter, type CounterPrintPayload } from "@/lib/counter-printer";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/order/$orderId")({ component: OrderPage });

const VOID_PRESETS = [
  { key: "void_reason_changed_mind" as const },
  { key: "void_reason_wrong_order" as const },
  { key: "void_reason_other" as const },
] satisfies { key: "void_reason_changed_mind" | "void_reason_wrong_order" | "void_reason_other" }[];

const CLOSE_PRESETS = [
  { key: "customer_left", th: "ลูกค้าออกไปแล้ว", en: "Customer left" },
  { key: "wrong_table",   th: "สั่งผิดโต๊ะ",     en: "Wrong table"    },
  { key: "test_order",    th: "ออเดอร์ทดสอบ",    en: "Test order"     },
  { key: "close_other",   th: "อื่นๆ",            en: "Other"          },
];

type Menu = { id: string; category_id: string | null; name_th: string; name_en: string; name_my: string; price: number; cost?: number; available: boolean; image_url: string | null; sort: number };
type Category = { id: string; name_th: string; name_en: string; name_my: string; sort: number; kitchen_zone_id?: string | null };
type Item = {
  id: string; menu_id: string | null; name_th: string; name_en: string; name_my: string;
  qty: number; unit_price: number; notes: string | null; modifiers: unknown;
  status: "pending" | "sent" | "served" | "voided";
  set_config?: any;
};
type AddonOption = { id: string; name: string; price: number };
type AddonGroup = { id: string; name: string; kitchen_name: string | null; addon_options: AddonOption[] };
type SelectedAddon = { group_id: string; group_name: string; option_id: string; option_name: string; price: number; qty: number };
type Modifier = { option_id: string; group_name: string; option_name: string; price: number; qty: number };

function MenuCardImage({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="w-full aspect-[4/3] bg-muted flex items-center justify-center text-5xl select-none" aria-hidden="true">
        🍽️
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className="w-full aspect-[4/3] object-contain bg-muted"
      onError={() => setFailed(true)}
    />
  );
}

function OrderPage() {
  const { orderId } = Route.useParams();
  const { t, lang } = useI18n();
  const { staff } = useAuth();
  const nav = useNavigate();
  const [menus, setMenus] = useState<Menu[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [activeCat, setActiveCat] = useState<string | "all">("all");
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Menu | null>(null);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [addonGroups, setAddonGroups] = useState<AddonGroup[]>([]);
  const [selectedAddons, setSelectedAddons] = useState<Map<string, SelectedAddon>>(new Map());
  const [voidItem, setVoidItem] = useState<Item | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidPreset, setVoidPreset] = useState<string>("");
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerAction, setManagerAction] = useState<"void" | "close_table" | "move_table" | null>(null);
  const [tableCode, setTableCode] = useState<string>("");
  const [tableId, setTableId] = useState<string>("");
  const [tableHasQrAlert, setTableHasQrAlert] = useState(false);
  const [orderSource, setOrderSource] = useState<string>("pos");
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [closeTableOpen, setCloseTableOpen] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [closePreset, setClosePreset] = useState("");
  const [moveTableOpen, setMoveTableOpen] = useState(false);
  const [availableTables, setAvailableTables] = useState<{ id: string; code: string }[]>([]);
  const [selectedSet, setSelectedSet] = useState<typeof SETS[0] | null>(null);

  // Bill preview
  const [billOpen, setBillOpen] = useState(false);
  const [customerViewOpen, setCustomerViewOpen] = useState(false);
  const [settingsVatMode, setSettingsVatMode] = useState<"inclusive" | "exclusive">("inclusive");
  const [settingsVatRate, setSettingsVatRate] = useState(7);
  const [restaurantName, setRestaurantName] = useState("");

  const loadAll = async () => {
    const [{ data: m }, { data: c }, { data: it }, { data: ord }, { data: s }] = await Promise.all([
      supabase.from("menus").select("*").eq("available", true).order("sort"),
      supabase.from("categories").select("*").order("sort"),
      supabase.from("order_items").select("*").eq("order_id", orderId).order("sent_at", { ascending: true, nullsFirst: true }),
      supabase.from("orders").select("table_id,source,order_number").eq("id", orderId).single(),
      supabase.from("settings").select("vat_mode,vat_rate,restaurant_name").eq("id", 1).single(),
    ]);
    if (m) setMenus(m as Menu[]);
    if (c) setCats(c as Category[]);
    if (it) setItems(it as Item[]);
    if (s) { setSettingsVatMode((s.vat_mode as "inclusive" | "exclusive") || "inclusive"); setSettingsVatRate(Number(s.vat_rate) || 7); setRestaurantName(s.restaurant_name); }
    if (ord) {
      setOrderSource((ord as any).source ?? "pos");
      setOrderNumber((ord as any).order_number ?? null);
    }
    if (ord?.table_id) {
      setTableId(ord.table_id);
      const { data: tbl } = await supabase.from("restaurant_tables").select("code,has_qr_alert").eq("id", ord.table_id).single();
      if (tbl) {
        setTableCode(tbl.code);
        setTableHasQrAlert(Boolean((tbl as any).has_qr_alert));
      }
    }
  };

  useEffect(() => {
    loadAll();
    const ch = supabase
      .channel(`order-${orderId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items", filter: `order_id=eq.${orderId}` }, () => loadAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // Build a flat ordered list: iterate cats in DB order (already sorted by cat.sort),
  // then append each category's items sorted by menu.sort.
  // This guarantees grouping: Set Menu → … → LON-CUP, regardless of global menu.sort values.
  const allMenusSorted = useMemo(() => {
    const byCategory = new Map<string, Menu[]>();
    for (const m of menus) {
      const key = m.category_id ?? "__none__";
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key)!.push(m);
    }
    // Sort each bucket by menu.sort
    for (const bucket of byCategory.values()) {
      bucket.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    }
    // Walk categories in their DB-sorted order (cats is already .order("sort"))
    const result: Menu[] = [];
    for (const cat of cats) {
      const items = byCategory.get(cat.id);
      if (items) result.push(...items);
    }
    // Append uncategorised items at the end
    const none = byCategory.get("__none__");
    if (none) result.push(...none);
    return result;
  }, [menus, cats]);

  const filteredMenus = useMemo(
    () => activeCat === "all" ? allMenusSorted : allMenusSorted.filter((m) => m.category_id === activeCat),
    [allMenusSorted, activeCat],
  );

  const openMenu = async (m: Menu) => {
    // Detect set-menu items by name (e.g. "Lon Moh - SET A", "Lon Moh - SET B", "Lon Moh - SET C")
    const combined = `${m.name_en} ${m.name_th}`.toLowerCase();
    const setId = combined.includes("set a") ? "A" : combined.includes("set b") ? "B" : combined.includes("set c") ? "C" : null;
    if (setId) {
      const setDef = SETS.find(s => s.id === setId);
      if (setDef) { setSelectedSet(setDef); return; }
    }
    setSelected(m); setQty(1); setNotes(""); setSelectedAddons(new Map()); setAddonGroups([]);
    // Two-step fetch (avoids relying on FK declarations for PostgREST nested selects)
    const db = supabase as any;
    // Step 1: get group_ids linked to this menu item
    const { data: links } = await db
      .from("menu_addons")
      .select("group_id")
      .eq("menu_id", m.id);
    const groupIds = ((links ?? []) as { group_id: string }[]).map((r) => r.group_id);
    if (groupIds.length === 0) return;
    // Step 2: fetch each group with its options
    const { data: groups, error: groupErr } = await db
      .from("addon_groups")
      .select("id, name, kitchen_name, addon_options(id, name, price)")
      .in("id", groupIds);
    if (groupErr) { console.error("[addons] addon_groups fetch error:", groupErr.message); return; }
    // Normalise: addon_options may be null if FK not wired in PostgREST
    const fetched = ((groups ?? []) as any[]).map((g) => ({
      ...g,
      addon_options: (g.addon_options ?? []) as AddonOption[],
    })) as AddonGroup[];
    console.log("[addons] groupIds:", groupIds, "fetched groups:", fetched);
    setAddonGroups(fetched);
  };

  const addToOrder = async () => {
    if (!selected) return;
    const addonsArr = Array.from(selectedAddons.values()).filter((a) => a.qty > 0);
    const addonPrice = addonsArr.reduce((s, a) => s + a.price * a.qty, 0);
    const unit_price = selected.price + addonPrice;
    const modifiers: Modifier[] | null = addonsArr.length > 0
      ? addonsArr.map((a) => ({ option_id: a.option_id, group_name: a.group_name, option_name: a.option_name, price: a.price, qty: a.qty }))
      : null;
    const { error } = await (supabase as any).from("order_items").insert({
      order_id: orderId, menu_id: selected.id,
      name_th: selected.name_th, name_en: selected.name_en, name_my: selected.name_my,
      qty, unit_price, unit_cost: selected.cost ?? 0, notes: notes || null, modifiers, status: "pending",
    });
    if (error) toast.error(error.message);
    setSelected(null);
  };

  const addSetToOrder = async (config: SetConfig) => {
    const setDef = SETS.find(s => s.id === config.set_id)!;
    const sideNames = config.sides.map(s => s.th).join(", ");
    const drinkNote = config.drink ? ` | เครื่องดื่ม: ${config.drink.th}` : "";
    const riceNote = config.rice === "rice" ? "ข้าวสวย" : "โจ๊ก";
    const kitchenNotes = `หลัก: ${config.main.th} | เครื่อง: ${sideNames}${drinkNote} | ${riceNote}`;
    const { error } = await (supabase as any).from("order_items").insert({
      order_id: orderId,
      menu_id: null,
      name_th: setDef.name_th,
      name_en: setDef.name_en,
      name_my: setDef.name_en,
      qty: 1,
      unit_price: setDef.price,
      unit_cost: 0,
      notes: kitchenNotes,
      status: "pending",
      set_config: config,
    });
    if (error) toast.error(error.message);
    setSelectedSet(null);
  };

  const adjustQty = async (item: Item, delta: number) => {
    if (item.status !== "pending") return;
    const newQty = item.qty + delta;
    if (newQty <= 0) {
      await supabase.from("order_items").delete().eq("id", item.id);
    } else {
      await supabase.from("order_items").update({ qty: newQty }).eq("id", item.id);
    }
  };

  const sendToKitchen = async () => {
    const pending = items.filter((i) => i.status === "pending");
    if (pending.length === 0) { toast.info(t("empty_order")); return; }
    const orderType = items.some((i) => i.status === "sent") ? "added" : "new";
    const ids = pending.map((p) => p.id);
    const sentAt = new Date().toISOString();
    await supabase.from("order_items").update({ status: "sent", sent_at: sentAt }).in("id", ids);
    // Queue print jobs — kitchen (Burmese) + counter (order copy)
    const zoneById = new Map<string, { id: string; name_th: string; name_en: string; sort: number; print_to_kitchen: boolean }>();
    const categoryById = new Map(cats.map((cat) => [cat.id, cat]));
    const menuById = new Map(menus.map((menu) => [menu.id, menu]));
    const { data: zones } = await supabase.from("kitchen_zones").select("id,name_th,name_en,sort,print_to_kitchen").eq("active", true).order("sort");
    for (const zone of (zones ?? []) as { id: string; name_th: string; name_en: string; sort: number; print_to_kitchen: boolean }[]) zoneById.set(zone.id, zone);

    const lines = pending.map((p) => {
      const sc = p.set_config as SetConfig | null | undefined;
      const menu = p.menu_id ? menuById.get(p.menu_id) : null;
      const category = menu?.category_id ? categoryById.get(menu.category_id) : null;
      const zone = category?.kitchen_zone_id ? zoneById.get(category.kitchen_zone_id) : null;
      const zoneLabel = zone ? (lang === "th" ? zone.name_th : zone.name_en) : "Main Kitchen";
      const zoneId = zone?.id ?? "__main__";
      const printToKitchen = zone?.print_to_kitchen ?? true;
      if (sc) {
        const sideStr = sc.sides.map((s) => s.th).join(", ");
        const drinkStr = sc.drink ? ` | ${sc.drink.th}` : "";
        const riceStr = sc.rice === "rice" ? "ข้าวสวย" : "โจ๊ก";
        const setNotes = `หลัก: ${sc.main.th} | ${sideStr}${drinkStr} | ${riceStr}`;
        return { name_my: p.name_en, name_en: p.name_en, name_th: p.name_th, qty: p.qty, notes: setNotes, modifiers: null, zoneId, zoneLabel, printToKitchen };
      }
      return { name_my: p.name_my, name_en: p.name_en, name_th: p.name_th, qty: p.qty, notes: p.notes, modifiers: (p.modifiers as Modifier[] | null) ?? null, zoneId, zoneLabel, printToKitchen };
    });
    const displayLabel = orderSource === "takeout" ? `Takeout ${orderNumber ?? ""}` : orderSource === "staff_meal" ? `Staff ${orderNumber ?? ""}` : tableCode;
    const counterLines = lines.map(({ zoneId: _zoneId, zoneLabel: _zoneLabel, printToKitchen: _printToKitchen, ...line }) => line);
    const ticketPayload: CounterPrintPayload = { kind: "order_ticket", table: displayLabel, order_type: orderType, lines: counterLines, sent_at: sentAt };
    const grouped = new Map<string, { zoneLabel: string; lines: typeof counterLines }>();
    for (const line of lines) {
      if (!line.printToKitchen) continue;
      const entry = grouped.get(line.zoneId) ?? { zoneLabel: line.zoneLabel, lines: [] };
      const { zoneId: _zoneId, zoneLabel: _zoneLabel, printToKitchen: _printToKitchen, ...ticketLine } = line;
      entry.lines.push(ticketLine);
      grouped.set(line.zoneId, entry);
    }
    const kitchenJobs = [...grouped.values()].map((group, index, all) => ({
      printer: "kitchen" as const,
      payload: {
        ...ticketPayload,
        lines: group.lines,
        language: "my",
        department: group.zoneLabel,
        station: group.zoneLabel,
        ticketIndex: index + 1,
        ticketTotal: all.length,
      },
    }));
    if (kitchenJobs.length > 0) await supabase.from("print_jobs").insert(kitchenJobs);
    await printCounter({ ...ticketPayload, language: "th" });
    toast.success(t("send_to_kitchen") + " ✓");
  };

  const requestVoid = (item: Item) => {
    setVoidItem(item); setVoidReason(""); setVoidPreset("");
  };

  const closeVoidDialog = () => {
    setVoidItem(null); setVoidReason(""); setVoidPreset("");
  };

  const performVoid = async () => {
    if (!voidItem || !voidReason.trim()) return;
    if (staff?.role === "staff") { setManagerAction("void"); setManagerOpen(true); return; }
    await doVoid();
  };

  const doVoid = async () => {
    if (!voidItem) return;
    await supabase.from("order_items").update({
      status: "voided", void_reason: voidReason, voided_by: staff?.id, voided_at: new Date().toISOString(),
    }).eq("id", voidItem.id);
    await supabase.from("voids").insert({
      order_item_id: voidItem.id, reason: voidReason, voided_by: staff?.id,
      amount: voidItem.qty * voidItem.unit_price,
    });
    setVoidItem(null); setVoidReason(""); setVoidPreset("");
    toast.success("Voided");
  };

  const goToPayment = async () => {
    const live = items.filter((i) => i.status !== "voided");
    if (live.length === 0) { toast.error(t("empty_order")); return; }
    const pending = live.some((i) => i.status === "pending");
    if (pending) { toast.error(t("send_to_kitchen") + " first"); return; }
    // Get/create bill
    let { data: bill } = await supabase.from("bills").select("id").eq("order_id", orderId).maybeSingle();
    if (!bill) {
      const { data: settings } = await supabase.from("settings").select("vat_mode,vat_rate").eq("id", 1).single();
      const subtotal = live.reduce((s, i) => s + i.qty * Number(i.unit_price), 0);
      const { data: ord } = await supabase.from("orders").select("table_id, shift_id").eq("id", orderId).single();
      const { data: nb } = await supabase.from("bills").insert({
        order_id: orderId, shift_id: ord?.shift_id, subtotal, total: subtotal,
        vat_mode: settings?.vat_mode || "inclusive", vat_rate: settings?.vat_rate || 7,
      }).select("id").single();
      bill = nb;
      if (ord?.table_id) await supabase.from("restaurant_tables").update({ status: "bill_requested" }).eq("id", ord.table_id);
    }
    if (bill) nav({ to: "/payment/$billId", params: { billId: bill.id } });
  };

  const loadAvailableTables = async () => {
    const { data } = await supabase.from("restaurant_tables").select("id,code").eq("status", "available").order("code");
    setAvailableTables(data ?? []);
  };

  const openCloseTable = () => {
    if (staff?.role === "staff") { setManagerAction("close_table"); setManagerOpen(true); return; }
    setCloseTableOpen(true);
  };

  const openMoveTable = async () => {
    if (staff?.role === "staff") { setManagerAction("move_table"); setManagerOpen(true); return; }
    await loadAvailableTables();
    setMoveTableOpen(true);
  };

  const acknowledgeQrAlert = async () => {
    if (!tableId) return;
    await supabase.from("restaurant_tables").update({ has_qr_alert: false }).eq("id", tableId);
    setTableHasQrAlert(false);
    toast.success(lang === "th" ? "รับทราบออเดอร์ QR แล้ว" : "QR order checked");
  };

  const doCloseTable = async () => {
    // For table orders, tableId is required; for takeout/staff meal it can be absent
    const isTableOrder = orderSource === "pos" || orderSource === "qr";
    if (isTableOrder && !tableId) return;
    const unpaid = items.filter((i) => i.status !== "voided");
    // If there are unpaid items, a reason must be selected
    if (unpaid.length > 0 && !closeReason.trim()) return;

    const reason = closeReason.trim() || (lang === "th" ? "ปิดโต๊ะ" : "Table closed");
    const now = new Date().toISOString();

    // Fetch shift_id so voids are attributed to this shift
    const { data: ord } = await supabase.from("orders").select("shift_id").eq("id", orderId).single();
    const shiftId = ord?.shift_id;

    if (unpaid.length > 0) {
      const unpaidIds = unpaid.map((i) => i.id);
      await supabase.from("order_items").update({
        status: "voided", void_reason: reason, voided_by: staff?.id, voided_at: now,
      }).in("id", unpaidIds);

      // Insert void records — these flow into Z-report "Voids total"
      if (shiftId) {
        await supabase.from("voids").insert(
          unpaid.map((i) => ({
            order_item_id: i.id,
            reason,
            voided_by: staff?.id,
            amount: i.qty * Number(i.unit_price),
            shift_id: shiftId,
          }))
        );
      }
    }

    // Step 1 — always-safe fields (no new columns required)
    const { error: cancelErr } = await supabase.from("orders").update({
      status: "cancelled", closed_at: now,
    }).eq("id", orderId);

    if (cancelErr) { toast.error("Failed to close table"); return; }

    // Step 2 — extended fields added by migration 20260521000002
    // Silently ignored if migration hasn't run yet; will work once columns exist
    await supabase.from("orders").update({
      cancel_reason: reason, closed_by: staff?.id,
    } as any).eq("id", orderId);

    if (tableId) {
      await supabase.from("restaurant_tables").update({ status: "available", guests: 0, has_qr_alert: false }).eq("id", tableId);
    }

    setCloseTableOpen(false);
    setCloseReason("");
    setClosePreset("");
    toast.success(lang === "th" ? "ปิดโต๊ะแล้ว" : "Table closed");
    nav({ to: "/pos" });
  };

  const doMoveTable = async (targetId: string) => {
    if (!tableId) return;
    const { data: ord } = await supabase.from("orders").select("guests").eq("id", orderId).single();
    await supabase.from("orders").update({ table_id: targetId }).eq("id", orderId);
    await supabase.from("restaurant_tables").update({ status: "available", guests: 0, has_qr_alert: false }).eq("id", tableId);
    await supabase.from("restaurant_tables").update({ status: "occupied", guests: ord?.guests ?? 1 }).eq("id", targetId);
    const { data: newTbl } = await supabase.from("restaurant_tables").select("code").eq("id", targetId).single();
    setTableId(targetId);
    if (newTbl) setTableCode(newTbl.code);
    setMoveTableOpen(false);
    toast.success(lang === "th" ? `ย้ายไปโต๊ะ ${newTbl?.code ?? ""}` : `Moved to table ${newTbl?.code ?? ""}`);
  };

  const liveItems = items.filter((i) => i.status !== "voided");
  const subtotal = liveItems.reduce((s, i) => s + i.qty * Number(i.unit_price), 0);

  // Bill preview totals (mirrors payment screen VAT logic)
  const vatRate = settingsVatRate / 100;
  const billVatAmount = settingsVatMode === "exclusive"
    ? subtotal * vatRate
    : subtotal - subtotal / (1 + vatRate);
  const billTotal = settingsVatMode === "exclusive" ? subtotal + billVatAmount : subtotal;

  const printBillPreview = async () => {
    if (liveItems.length === 0) { toast.error(t("empty_order")); return; }
    await printCounter({
      kind: "receipt", table: tableCode, restaurant: restaurantName,
      items: liveItems, total: billTotal,
      vatAmount: settingsVatMode === "exclusive" ? billVatAmount : 0,
      vat_mode: settingsVatMode, payments: [], language: lang,
    });
    toast.success("Bill sent to printer");
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] h-[calc(100vh-3.5rem)]">
      {/* Menu */}
      <div className="overflow-auto flex flex-col">
        {/* Page header — scrolls away */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-2 flex-wrap">
          <Link to="/pos"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />{t("back")}</Button></Link>
          {orderSource === "takeout" ? (
            <h1 className="text-xl font-bold flex items-center gap-2">
              <span className="text-blue-600 dark:text-blue-400">{t("takeout")}</span>
              {orderNumber && <span className="text-base font-mono bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">{orderNumber}</span>}
            </h1>
          ) : orderSource === "staff_meal" ? (
            <h1 className="text-xl font-bold flex items-center gap-2">
              <span className="text-purple-600 dark:text-purple-400">{t("staff_meal")}</span>
              {orderNumber && <span className="text-base font-mono bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded">{orderNumber}</span>}
            </h1>
          ) : (
            <h1 className="text-xl font-bold flex items-center gap-2">
              {t("table")} {tableCode}
              {orderSource === "qr" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground">
                  <Bell className="h-3 w-3" />QR
                </span>
              )}
            </h1>
          )}
          <div className="ml-auto flex gap-2">
            {(orderSource === "pos" || orderSource === "qr") && (
              <Button size="sm" variant="outline" onClick={openMoveTable}>
                <ArrowLeftRight className="h-4 w-4 mr-1" />{t("move_table")}
              </Button>
            )}
            <Button size="sm" variant="destructive" onClick={openCloseTable}>
              <X className="h-4 w-4 mr-1" />{t("close_table")}
            </Button>
          </div>
        </div>

        {tableHasQrAlert && (
          <div className="mx-4 mb-3 rounded-xl border border-destructive bg-destructive/10 p-3 text-sm flex items-center gap-3">
            <Bell className="h-5 w-5 text-destructive animate-pulse shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold text-destructive">{t("qr_alert")}</div>
              <div className="text-muted-foreground">
                {lang === "th" ? "ตรวจรายการ QR ที่เพิ่งเข้ามา แล้วกดรับทราบ" : "Review the latest QR order, then mark it checked."}
              </div>
            </div>
            <Button size="sm" className="ml-auto shrink-0" onClick={acknowledgeQrAlert}>
              {lang === "th" ? "รับทราบ" : "Checked"}
            </Button>
          </div>
        )}

        {/* Category filter bar — sticks to top when scrolling */}
        <div className="sticky top-0 z-10 bg-background border-b px-4 py-2 flex gap-2 flex-wrap">
          <Button variant={activeCat === "all" ? "default" : "outline"} size="sm" onClick={() => setActiveCat("all")}>All</Button>
          {cats.map((c) => (
            <Button key={c.id} variant={activeCat === c.id ? "default" : "outline"} size="sm" onClick={() => setActiveCat(c.id)}>
              {pickName(c, lang)}
            </Button>
          ))}
        </div>

        {/* Menu grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 p-4">
          {filteredMenus.map((m) => (
            <button
              key={m.id}
              onClick={() => openMenu(m)}
              className="text-left rounded-xl border bg-card hover:border-primary hover:shadow-md transition overflow-hidden focus-visible:ring-2 focus-visible:ring-primary"
            >
              <MenuCardImage src={m.image_url} alt={pickName(m, lang)} />
              <div className="p-3">
                <div className="font-medium leading-tight line-clamp-2">{pickName(m, lang)}</div>
                <div className="text-xs text-muted-foreground mt-0.5 truncate">{lang === "th" ? m.name_en : m.name_th}</div>
                <div className="mt-2 font-bold text-primary">{thb(m.price)}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Order panel */}
      <aside className="border-l bg-card flex flex-col">
        <div className="p-4 border-b">
          <h2 className="font-bold">{t("order")}</h2>
        </div>
        <div className="flex-1 overflow-auto p-3 space-y-2">
          {liveItems.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">{t("empty_order")}</p>}
          {liveItems.map((i) => {
            const sc = i.set_config as SetConfig | undefined | null;
            if (sc) {
              // SET ITEM
              return (
                <div key={i.id} className="rounded-lg border-2 border-amber-200 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                        <Layers className="h-3.5 w-3.5 shrink-0" />
                        {lang === "th" ? i.name_th : i.name_en}
                      </div>
                      <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground pl-5">
                        <div>🍽️ {sc.main.th}{lang === "en" ? ` (${sc.main.en})` : ""}</div>
                        {sc.sides.map((s, idx) => (
                          <div key={idx}>🥗 {s.th}{lang === "en" ? ` (${s.en})` : ""}</div>
                        ))}
                        {sc.drink && (
                          <div>🥤 {sc.drink.th}{lang === "en" ? ` (${sc.drink.en})` : ""} <span className="text-amber-600 font-semibold">FREE</span></div>
                        )}
                        <div>🍚 {sc.rice === "rice" ? (lang === "th" ? "ข้าวสวย" : "Steamed Rice") : (lang === "th" ? "โจ๊ก" : "Porridge")}</div>
                      </div>
                      <div className="text-xs mt-1.5 pl-5">
                        <span className={`inline-block px-1.5 py-0.5 rounded ${i.status === "pending" ? "bg-warning/20 text-warning-foreground" : "bg-success/20 text-success-foreground"}`}>
                          {i.status === "pending" ? t("pending") : t("sent")}
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-amber-700 dark:text-amber-300">{thb(Number(i.unit_price))}</div>
                    </div>
                  </div>
                  {i.status === "pending" && (
                    <div className="flex justify-end mt-2">
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => requestVoid(i)}>
                        <Trash2 className="h-3 w-3 mr-1" />VOID
                      </Button>
                    </div>
                  )}
                  {i.status === "sent" && (
                    <div className="flex justify-end mt-2">
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => requestVoid(i)}>
                        <Trash2 className="h-3 w-3 mr-1" />VOID
                      </Button>
                    </div>
                  )}
                </div>
              );
            }
            // --- regular item (original code preserved exactly) ---
            const mods = Array.isArray(i.modifiers) ? (i.modifiers as Modifier[]) : [];
            return (
              <div key={i.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{pickName(i, lang)}</div>
                    {mods.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {mods.map((m) => {
                          const q = m.qty ?? 1;
                          return `+ ${m.option_name}${q > 1 ? ` ×${q}` : ""}${m.price > 0 ? ` (+${thb(m.price * q)})` : ""}`;
                        }).join(" · ")}
                      </div>
                    )}
                    {i.notes && <div className="text-xs text-muted-foreground">📝 {i.notes}</div>}
                    <div className="text-xs mt-1">
                      <span className={`inline-block px-1.5 py-0.5 rounded ${i.status === "pending" ? "bg-warning/20 text-warning-foreground" : "bg-success/20 text-success-foreground"}`}>
                        {i.status === "pending" ? t("pending") : t("sent")}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold">{thb(i.qty * Number(i.unit_price))}</div>
                    <div className="text-xs text-muted-foreground">{i.qty} × {thb(i.unit_price)}</div>
                  </div>
                </div>
                {i.status === "pending" && (
                  <div className="flex items-center gap-2 mt-2">
                    <Button size="sm" variant="outline" onClick={() => adjustQty(i, -1)}><Minus className="h-3 w-3" /></Button>
                    <span className="text-sm font-medium w-6 text-center">{i.qty}</span>
                    <Button size="sm" variant="outline" onClick={() => adjustQty(i, 1)}><Plus className="h-3 w-3" /></Button>
                    <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => requestVoid(i)}>
                      <Trash2 className="h-3 w-3 mr-1" />VOID
                    </Button>
                  </div>
                )}
                {i.status === "sent" && (
                  <div className="flex justify-end mt-2">
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => requestVoid(i)}>
                      <Trash2 className="h-3 w-3 mr-1" />VOID
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="border-t p-4 space-y-3">
          <div className="flex justify-between text-lg font-bold">
            <span>{t("subtotal")}</span><span>{thb(subtotal)}</span>
          </div>
          <Button className="w-full" size="lg" variant="secondary" onClick={sendToKitchen}>
            <ChefHat className="h-4 w-4 mr-2" />{t("send_to_kitchen")}
          </Button>
          <Button className="w-full" size="lg" variant="outline" onClick={() => setBillOpen(true)} disabled={liveItems.length === 0}>
            <Printer className="h-4 w-4 mr-2" />Print Bill
          </Button>
          <Button className="w-full" size="lg" onClick={goToPayment}>
            <Receipt className="h-4 w-4 mr-2" />{t("go_to_payment")}
          </Button>
        </div>
      </aside>

      {/* Add item dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) { setSelected(null); setAddonGroups([]); setSelectedAddons(new Map()); } }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{selected ? pickName(selected, lang) : ""}</DialogTitle></DialogHeader>
          {selected && (() => {
            const addonTotal = Array.from(selectedAddons.values()).reduce((s, a) => s + a.price * a.qty, 0);
            const totalPrice = (selected.price + addonTotal) * qty;
            return (
              <div className="space-y-4">
                <div>
                  <Label>{t("qty")}</Label>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => setQty(Math.max(1, qty - 1))}><Minus className="h-4 w-4" /></Button>
                    <Input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} className="text-center" />
                    <Button variant="outline" onClick={() => setQty(qty + 1)}><Plus className="h-4 w-4" /></Button>
                  </div>
                </div>

                {/* ── Add-on groups ── */}
                {addonGroups.length > 0 && (
                  <div className="space-y-3">
                    <Label>{lang === "th" ? "ท็อปปิ้ง / เพิ่มเติม" : "Add-ons"}</Label>
                    {addonGroups.map((group) => (
                      <div key={group.id}>
                        <p className="text-sm font-medium mb-1.5">{group.name}</p>
                        <div className="space-y-1.5">
                          {(group.addon_options ?? []).map((opt) => {
                            const current = selectedAddons.get(opt.id);
                            const optQty = current?.qty ?? 0;
                            return (
                              <div
                                key={opt.id}
                                className={`flex items-center justify-between rounded-lg border px-3 py-2 transition-colors
                                  ${optQty > 0 ? "border-primary bg-primary/5" : "border-border"}`}
                              >
                                <span className="text-sm">
                                  {opt.name}
                                  {opt.price > 0 && (
                                    <span className="text-muted-foreground ml-1">+{thb(opt.price)}</span>
                                  )}
                                </span>
                                <div className="flex items-center gap-2 shrink-0">
                                  <Button
                                    size="icon" variant="outline" className="h-7 w-7"
                                    type="button"
                                    onClick={() => setSelectedAddons((prev) => {
                                      const next = new Map(prev);
                                      if (optQty <= 1) { next.delete(opt.id); }
                                      else { next.set(opt.id, { ...current!, qty: optQty - 1 }); }
                                      return next;
                                    })}
                                  ><Minus className="h-3 w-3" /></Button>
                                  <span className="w-5 text-center text-sm tabular-nums font-medium">{optQty}</span>
                                  <Button
                                    size="icon" variant="outline" className="h-7 w-7"
                                    type="button"
                                    onClick={() => setSelectedAddons((prev) => {
                                      const next = new Map(prev);
                                      if (current) { next.set(opt.id, { ...current, qty: optQty + 1 }); }
                                      else { next.set(opt.id, { group_id: group.id, group_name: group.kitchen_name ?? group.name, option_id: opt.id, option_name: opt.name, price: opt.price, qty: 1 }); }
                                      return next;
                                    })}
                                  ><Plus className="h-3 w-3" /></Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div>
                  <Label>{t("notes")}</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ไม่เผ็ด, no spicy…" />
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => { setSelected(null); setAddonGroups([]); setSelectedAddons(new Map()); }}>{t("cancel")}</Button>
                  <Button onClick={addToOrder}>{t("add_to_order")} · {thb(totalPrice)}</Button>
                </DialogFooter>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Void dialog */}
      <Dialog open={!!voidItem} onOpenChange={(o) => !o && closeVoidDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-warning" />{t("void")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{voidItem ? pickName(voidItem, lang) : ""}</p>
            <Label>{t("void_reason")}</Label>
            <div className="flex flex-col gap-2">
              {VOID_PRESETS.map((p) => (
                <Button
                  key={p.key}
                  type="button"
                  variant={voidPreset === p.key ? "default" : "outline"}
                  size="sm"
                  className="justify-start"
                  onClick={() => {
                    setVoidPreset(p.key);
                    if (p.key !== "void_reason_other") setVoidReason(t(p.key));
                    else setVoidReason("");
                  }}
                >
                  {t(p.key)}
                </Button>
              ))}
            </div>
            {voidPreset === "void_reason_other" && (
              <Textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder={lang === "th" ? "ระบุเหตุผล…" : "Enter reason…"}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeVoidDialog}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={performVoid} disabled={!voidReason.trim()}>{t("confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close table dialog — reason required when there are unpaid items */}
      <Dialog open={closeTableOpen} onOpenChange={(o) => { if (!o) { setCloseReason(""); setClosePreset(""); } setCloseTableOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {t("close_table")} — {tableCode}
            </DialogTitle>
          </DialogHeader>

          {liveItems.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {lang === "th"
                  ? `มีรายการที่ยังไม่ชำระ ${liveItems.length} รายการ กรุณาระบุเหตุผลที่ปิดโต๊ะ`
                  : `${liveItems.length} unpaid item${liveItems.length > 1 ? "s" : ""}. Please select a reason.`}
              </p>
              <div className="flex flex-col gap-2">
                {CLOSE_PRESETS.map((p) => (
                  <Button
                    key={p.key}
                    type="button"
                    variant={closePreset === p.key ? "default" : "outline"}
                    size="sm"
                    className="justify-start"
                    onClick={() => {
                      setClosePreset(p.key);
                      if (p.key !== "close_other") setCloseReason(lang === "th" ? p.th : p.en);
                      else setCloseReason("");
                    }}
                  >
                    {lang === "th" ? p.th : p.en}
                  </Button>
                ))}
              </div>
              {closePreset === "close_other" && (
                <Textarea
                  value={closeReason}
                  onChange={(e) => setCloseReason(e.target.value)}
                  placeholder={lang === "th" ? "ระบุเหตุผล…" : "Enter reason…"}
                  className="mt-1"
                />
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {lang === "th"
                ? `ยืนยันปิดโต๊ะ ${tableCode}? โต๊ะจะว่างทันที`
                : `Close table ${tableCode}? The table will be freed immediately.`}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setCloseReason(""); setClosePreset(""); setCloseTableOpen(false); }}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={doCloseTable}
              disabled={liveItems.length > 0 && !closeReason.trim()}
            >
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move table dialog */}
      <Dialog open={moveTableOpen} onOpenChange={setMoveTableOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("move_table")} — {lang === "th" ? "เลือกโต๊ะที่ว่าง" : "Select an available table"}</DialogTitle>
          </DialogHeader>
          {availableTables.length === 0 ? (
            <p className="text-center text-muted-foreground py-6">{lang === "th" ? "ไม่มีโต๊ะว่าง" : "No available tables"}</p>
          ) : (
            <div className="grid grid-cols-4 gap-2 py-2">
              {availableTables.map((tbl) => (
                <Button key={tbl.id} variant="outline" className="h-14 text-base font-bold" onClick={() => doMoveTable(tbl.id)}>
                  {tbl.code}
                </Button>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveTableOpen(false)}>{t("cancel")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ManagerPinDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        onApproved={async () => {
          if (managerAction === "void") { doVoid(); }
          else if (managerAction === "close_table") { setCloseTableOpen(true); }
          else if (managerAction === "move_table") { await loadAvailableTables(); setMoveTableOpen(true); }
          setManagerAction(null);
        }}
      />

      {/* Bill preview dialog */}
      <Dialog open={billOpen} onOpenChange={setBillOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-center">{restaurantName || "Restaurant"}</DialogTitle>
          </DialogHeader>
          <p className="text-center text-sm text-muted-foreground -mt-2">
            {orderSource === "takeout" ? `${t("takeout")} · ${orderNumber ?? ""}` : orderSource === "staff_meal" ? `${t("staff_meal")} · ${orderNumber ?? ""}` : `${t("table")} ${tableCode}`}
            {" · "}{new Date().toLocaleString(lang === "th" ? "th-TH" : "en-US")}
          </p>
          <div className="space-y-1 max-h-56 overflow-y-auto text-sm border rounded-lg p-3 bg-muted/30">
            {liveItems.map((i) => (
              <div key={i.id} className="flex justify-between">
                <span className="truncate mr-2">{pickName(i, lang)} <span className="text-muted-foreground">×{i.qty}</span></span>
                <span className="shrink-0 tabular-nums">{thb(i.qty * Number(i.unit_price))}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>{t("subtotal")}</span><span className="tabular-nums">{thb(subtotal)}</span>
            </div>
            {settingsVatMode === "exclusive" && billVatAmount > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>VAT {settingsVatRate}%</span><span className="tabular-nums">{thb(billVatAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-xl font-bold border-t pt-2 mt-1">
              <span>{t("total")}</span><span className="tabular-nums">{thb(billTotal)}</span>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { setBillOpen(false); setCustomerViewOpen(true); }}>
              <Eye className="h-4 w-4 mr-1" />Show Customer
            </Button>
            <Button className="flex-1" onClick={() => { printBillPreview(); setBillOpen(false); }}>
              <Printer className="h-4 w-4 mr-1" />Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Customer-facing full-screen bill view */}
      {customerViewOpen && (
        <div
          className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center p-8 cursor-pointer select-none"
          onClick={() => setCustomerViewOpen(false)}
        >
          <p className="text-base text-muted-foreground">{restaurantName}</p>
          <p className="text-3xl font-bold mt-1 mb-8">
            {orderSource === "takeout" ? `${t("takeout")} · ${orderNumber ?? ""}` : orderSource === "staff_meal" ? `${t("staff_meal")} · ${orderNumber ?? ""}` : `${t("table")} ${tableCode}`}
          </p>
          <div className="w-full max-w-xs space-y-2 mb-8">
            {liveItems.map((i) => (
              <div key={i.id} className="flex justify-between text-lg">
                <span className="truncate mr-2">{pickName(i, lang)} <span className="text-muted-foreground text-base">×{i.qty}</span></span>
                <span className="shrink-0 tabular-nums">{thb(i.qty * Number(i.unit_price))}</span>
              </div>
            ))}
          </div>
          {settingsVatMode === "exclusive" && billVatAmount > 0 && (
            <p className="text-muted-foreground text-lg mb-1">VAT {settingsVatRate}%: {thb(billVatAmount)}</p>
          )}
          <div className="border-t w-full max-w-xs pt-6 text-center">
            <p className="text-muted-foreground text-lg">{t("total")}</p>
            <p className="text-8xl font-black mt-2 tabular-nums">{thb(billTotal)}</p>
          </div>
          <p className="text-sm text-muted-foreground mt-16 animate-pulse">Tap anywhere to close</p>
        </div>
      )}

      <SetMenuDialog
        key={selectedSet?.id}
        setDef={selectedSet}
        onClose={() => setSelectedSet(null)}
        onConfirm={addSetToOrder}
      />
    </div>
  );
}
