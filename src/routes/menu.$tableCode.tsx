import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ShoppingCart, Plus, Minus, Check, Languages, Layers } from "lucide-react";
import { toast } from "sonner";
import { SETS, SET_C_DRINKS, type SetDef, type SetConfig, type SetItem } from "@/lib/set-menu";

export const Route = createFileRoute("/menu/$tableCode")({
  component: CustomerMenu,
  head: () => ({
    meta: [
      { title: "Menu" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
    ],
  }),
});

type Menu = { id: string; category_id: string | null; name_th: string; name_en: string; price: number; image_url: string | null; sort: number };
type Category = { id: string; name_th: string; name_en: string; sort: number };
type AddonOption = { id: string; name: string; price: number };
type AddonGroup = { id: string; name: string; kitchen_name: string | null; addon_options: AddonOption[] };
type SelectedAddon = { group_id: string; group_name: string; option_id: string; option_name: string; price: number };
type CartItem = { menu_id: string; name_th: string; name_en: string; price: number; qty: number; notes?: string; set_config?: SetConfig; addons?: SelectedAddon[] };
type Lang = "th" | "en";

const T = {
  th: {
    menu: "เมนู", table: "โต๊ะ", cart: "ตะกร้า", add: "เพิ่ม", submit: "ส่งออเดอร์",
    qty: "จำนวน", notes: "หมายเหตุ", empty: "ยังไม่มีรายการ", total: "รวม",
    confirm: "ยืนยันสั่ง", cancel: "ยกเลิก",
    thanks: "ขอบคุณค่ะ! ออเดอร์ของคุณกำลังรอพนักงานยืนยัน",
    order_more: "สั่งเพิ่ม", all: "ทั้งหมด",
    // set menu
    set_main: "อาหารหลัก", set_sides: "เครื่องเคียง", set_free_drink: "เครื่องดื่มฟรี 🥤",
    set_rice: "ข้าว", set_steamed: "ข้าวสวย 🍚", set_porridge: "โจ๊ก 🥣",
    set_summary: "สรุปรายการ", set_includes: "รวมข้าวสวยหรือโจ๊ก",
    set_select1: "เลือก 1", set_select2: "เลือก 2", set_free: "ฟรี",
    // add-ons
    add_ons: "ท็อปปิ้ง / เพิ่มเติม",
  },
  en: {
    menu: "Menu", table: "Table", cart: "Cart", add: "Add", submit: "Submit order",
    qty: "Qty", notes: "Notes", empty: "Cart is empty", total: "Total",
    confirm: "Place order", cancel: "Cancel",
    thanks: "Thank you! Your order is waiting for staff confirmation.",
    order_more: "Order more", all: "All",
    // set menu
    set_main: "Main Dish", set_sides: "Side Dishes", set_free_drink: "Free Drink 🥤",
    set_rice: "Rice", set_steamed: "Steamed Rice 🍚", set_porridge: "Porridge 🥣",
    set_summary: "Summary", set_includes: "Includes rice or porridge",
    set_select1: "Select 1", set_select2: "Select 2", set_free: "FREE",
    // add-ons
    add_ons: "Add-ons",
  },
};

// ── Inline set-menu dialog (no useI18n — QR page has no I18nProvider) ─────────
function QrSetDialog({ setDef, lang, tr, onClose, onConfirm }: {
  setDef: SetDef; lang: Lang; tr: typeof T["th"]; onClose: () => void;
  onConfirm: (config: SetConfig) => void;
}) {
  const [main, setMain] = useState<SetItem | null>(null);
  const [sides, setSides] = useState<SetItem[]>([]);
  const [drink, setDrink] = useState<SetItem | null>(null);
  const [rice, setRice] = useState<"rice" | "porridge">("rice");

  const toggleSide = (item: SetItem) => {
    setSides((prev) => {
      const exists = prev.some((s) => s.th === item.th);
      if (exists) return prev.filter((s) => s.th !== item.th);
      if (prev.length >= 2) return prev;
      return [...prev, item];
    });
  };

  const isReady = !!main && sides.length === 2 && (!setDef.hasDrink || !!drink);

  const handleConfirm = () => {
    if (!isReady) return;
    onConfirm({ set_id: setDef.id, main: main!, sides: sides as [SetItem, SetItem], drink: drink ?? undefined, rice });
  };

  const pick = (item: SetItem) => lang === "th" ? item.th : item.en;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <Layers className="h-5 w-5 text-amber-600" />
            {lang === "th" ? setDef.name_th : setDef.name_en}
            <span className="text-primary font-bold">฿{setDef.price}</span>
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{tr.set_includes}</p>
        </DialogHeader>

        <div className="space-y-5">
          {/* Main dish — radio */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-sm uppercase tracking-wide">{tr.set_main}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${main ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"}`}>
                {main ? `✓ 1/1` : tr.set_select1}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {setDef.mains.map((item) => (
                <button
                  key={item.th}
                  onClick={() => setMain(item)}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm text-left transition-colors
                    ${main?.th === item.th ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted/50"}`}
                >
                  <span className={`h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center
                    ${main?.th === item.th ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                    {main?.th === item.th && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </span>
                  <span className="flex-1">{item.th}</span>
                  {lang === "en" && <span className="text-muted-foreground text-xs">{item.en}</span>}
                </button>
              ))}
            </div>
          </section>

          {/* Side dishes — checkboxes (max 2) */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-sm uppercase tracking-wide">{tr.set_sides}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sides.length === 2 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"}`}>
                {sides.length === 2 ? `✓ 2/2` : `${sides.length}/2`}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {setDef.sides.map((item) => {
                const selected = sides.some((s) => s.th === item.th);
                const disabled = !selected && sides.length >= 2;
                return (
                  <button
                    key={item.th}
                    onClick={() => toggleSide(item)}
                    disabled={disabled}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm text-left transition-colors
                      ${selected ? "border-primary bg-primary/10 font-medium" : disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-muted/50"}`}
                  >
                    <span className={`h-4 w-4 rounded border-2 shrink-0 flex items-center justify-center
                      ${selected ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                      {selected && <Check className="h-2.5 w-2.5 text-white" />}
                    </span>
                    <span className="flex-1">{item.th}</span>
                    {lang === "en" && <span className="text-muted-foreground text-xs">{item.en}</span>}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Drink — SET C only */}
          {setDef.hasDrink && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-sm uppercase tracking-wide text-amber-600 dark:text-amber-400">{tr.set_free_drink}</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${drink ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"}`}>
                  {drink ? `✓ 1/1` : tr.set_select1}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {SET_C_DRINKS.map((item) => (
                  <button
                    key={item.th}
                    onClick={() => setDrink(item)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-left transition-colors
                      ${drink?.th === item.th ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30 font-medium" : "hover:bg-muted/50"}`}
                  >
                    <span className={`h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center
                      ${drink?.th === item.th ? "border-amber-500 bg-amber-500" : "border-muted-foreground"}`}>
                      {drink?.th === item.th && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </span>
                    <span>{pick(item)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Rice / porridge */}
          <section>
            <h3 className="font-semibold text-sm uppercase tracking-wide mb-2">{tr.set_rice}</h3>
            <div className="flex gap-2">
              {(["rice", "porridge"] as const).map((opt) => (
                <button
                  key={opt}
                  onClick={() => setRice(opt)}
                  className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-colors
                    ${rice === opt ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted/50"}`}
                >
                  {opt === "rice" ? tr.set_steamed : tr.set_porridge}
                </button>
              ))}
            </div>
          </section>

          {/* Live summary */}
          {(main || sides.length > 0) && (
            <section className="bg-muted/30 rounded-lg p-3 text-sm space-y-1">
              <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-1">{tr.set_summary}</p>
              {main && <p>🍽️ {main.th}{lang === "en" ? ` (${main.en})` : ""}</p>}
              {sides.map((s) => <p key={s.th}>🥗 {s.th}{lang === "en" ? ` (${s.en})` : ""}</p>)}
              {drink && <p>🥤 {drink.th} <span className="text-amber-600 font-semibold">{tr.set_free}</span></p>}
              <p>🍚 {rice === "rice" ? tr.set_steamed : tr.set_porridge}</p>
            </section>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>{tr.cancel}</Button>
          <Button className="flex-1" onClick={handleConfirm} disabled={!isReady}>
            {tr.add} · ฿{setDef.price}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Skeleton shown while menu data loads ──────────────────────────────────────
function MenuSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 bg-card border-b">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex-1 space-y-1.5 animate-pulse">
            <div className="h-3 w-28 bg-muted rounded" />
            <div className="h-5 w-16 bg-muted rounded" />
          </div>
          <div className="h-8 w-16 bg-muted rounded-md animate-pulse" />
        </div>
        <div className="max-w-2xl mx-auto px-4 pb-2 flex gap-2 animate-pulse">
          {[72, 96, 88, 104, 80].map((w, i) => (
            <div key={i} className="h-8 bg-muted rounded-full shrink-0" style={{ width: w }} />
          ))}
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-card border rounded-xl p-3 flex gap-3 animate-pulse">
            <div className="h-16 w-16 rounded-lg bg-muted shrink-0" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-4 bg-muted rounded w-3/4" />
              <div className="h-3 bg-muted rounded w-1/2" />
              <div className="h-4 bg-muted rounded w-1/4 mt-2" />
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}

// ── Lazy image with placeholder fallback ──────────────────────────────────────
function MenuImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <PlaceholderImg />;
  return (
    <img
      src={src}
      alt=""
      width={64}
      height={64}
      loading="lazy"
      decoding="async"
      className="h-16 w-16 rounded-lg object-cover shrink-0 bg-muted"
      onError={() => setFailed(true)}
    />
  );
}
function PlaceholderImg() {
  return (
    <div className="h-16 w-16 rounded-lg bg-muted shrink-0 grid place-items-center text-2xl select-none" aria-hidden>
      🍽️
    </div>
  );
}
// ── Large hero image shown at the top of the add-item popup ──────────────────
function PopupHeroImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div className="-mx-6 -mt-6 mb-2 bg-white flex items-center justify-center rounded-t-lg" style={{ minHeight: 300 }}>
      <img
        src={src}
        alt=""
        loading="eager"
        decoding="async"
        className="w-full max-h-[300px] object-contain rounded-t-lg"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
function CustomerMenu() {
  const { tableCode } = Route.useParams();
  const [lang, setLang] = useState<Lang>("th");
  const [data, setData] = useState<{ table: { id: string; code: string }; categories: Category[]; menus: Menu[]; restaurant_name: string; addonsByMenuId: Record<string, AddonGroup[]> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState<string | "all">("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [adding, setAdding] = useState<Menu | null>(null);
  const [addQty, setAddQty] = useState(1);
  const [addNotes, setAddNotes] = useState("");
  // selectedAddons: key = group_id, value = the chosen option for that group
  const [selectedAddons, setSelectedAddons] = useState<Map<string, SelectedAddon>>(new Map());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Set menu state
  const [selectedSetDef, setSelectedSetDef] = useState<SetDef | null>(null);
  const [setMenuOrigin, setSetMenuOrigin] = useState<Menu | null>(null);
  const catBarRef = useRef<HTMLDivElement>(null);
  const tr = T[lang];

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/public/qr-menu/${encodeURIComponent(tableCode)}`, { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { if (e.name !== "AbortError") { setError(String(e.message ?? e)); setLoading(false); } });
    return () => ac.abort();
  }, [tableCode]);

  // ── Same category-walk sort as the POS order screen ──────────────────────
  const allMenusSorted = useMemo(() => {
    if (!data) return [];
    const byCategory = new Map<string, Menu[]>();
    for (const m of data.menus) {
      const key = m.category_id ?? "__none__";
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key)!.push(m);
    }
    // Sort each category's items by menu.sort
    for (const bucket of byCategory.values()) {
      bucket.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    }
    // Walk categories in their sorted order (data.categories already sorted by sort)
    const result: Menu[] = [];
    for (const cat of data.categories) {
      const items = byCategory.get(cat.id);
      if (items) result.push(...items);
    }
    const none = byCategory.get("__none__");
    if (none) result.push(...none);
    return result;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return activeCat === "all"
      ? allMenusSorted
      : allMenusSorted.filter((m) => m.category_id === activeCat);
  }, [allMenusSorted, activeCat, data]);

  const cartTotal = useMemo(() => cart.reduce((s, c) => s + c.qty * c.price, 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((s, c) => s + c.qty, 0), [cart]);

  const openAdd = (m: Menu) => {
    // Detect set-menu items by name (e.g. "Lon Moh - SET A", "SET B", etc.)
    const combined = `${m.name_en} ${m.name_th}`.toLowerCase();
    const setId = combined.includes("set a") ? "A" : combined.includes("set b") ? "B" : combined.includes("set c") ? "C" : null;
    if (setId) {
      const setDef = SETS.find((s) => s.id === setId);
      if (setDef) { setSelectedSetDef(setDef); setSetMenuOrigin(m); return; }
    }
    setAdding(m); setAddQty(1); setAddNotes(""); setSelectedAddons(new Map());
  };

  const addToCart = () => {
    if (!adding) return;
    const addonsArr = Array.from(selectedAddons.values());
    const addonPrice = addonsArr.reduce((s, a) => s + a.price, 0);
    setCart((prev) => [...prev, {
      menu_id: adding.id,
      name_th: adding.name_th,
      name_en: adding.name_en,
      price: adding.price + addonPrice,
      qty: addQty,
      notes: addNotes || undefined,
      addons: addonsArr.length > 0 ? addonsArr : undefined,
    }]);
    setAdding(null);
  };

  const addSetToCart = (config: SetConfig) => {
    if (!setMenuOrigin) return;
    const sideStr = config.sides.map((s) => s.th).join(", ");
    const drinkStr = config.drink ? ` | ${config.drink.th}` : "";
    const riceStr = config.rice === "rice" ? "ข้าวสวย" : "โจ๊ก";
    const kitchenNotes = `หลัก: ${config.main.th} | ${sideStr}${drinkStr} | ${riceStr}`;
    setCart((prev) => [...prev, {
      menu_id: setMenuOrigin.id,
      name_th: setMenuOrigin.name_th,
      name_en: setMenuOrigin.name_en,
      price: setMenuOrigin.price,
      qty: 1,
      notes: kitchenNotes,
      set_config: config,
    }]);
    setSelectedSetDef(null);
    setSetMenuOrigin(null);
  };

  const updateQty = (idx: number, delta: number) => {
    setCart((prev) => prev.flatMap((c, i) => {
      if (i !== idx) return [c];
      const q = c.qty + delta;
      return q <= 0 ? [] : [{ ...c, qty: q }];
    }));
  };

  const submit = async () => {
    if (cart.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/public/qr-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table_code: tableCode,
          items: cart.map((c) => ({
            menu_id: c.menu_id,
            qty: c.qty,
            notes: c.notes ?? null,
            set_config: c.set_config ?? null,
            addons: (c.addons ?? []).map((a) => ({ option_id: a.option_id })),
          })),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setCart([]);
      setConfirmOpen(false);
      setSubmitted(true);
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setSubmitting(false);
    }
  };

  // Scroll active category tab into view
  const switchCat = (id: string | "all") => {
    setActiveCat(id);
    requestAnimationFrame(() => {
      catBarRef.current?.querySelector(`[data-cat="${id}"]`)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    });
  };

  const name = (m: { name_th: string; name_en: string }) => (lang === "th" ? m.name_th : m.name_en);
  const sub  = (m: { name_th: string; name_en: string }) => (lang === "th" ? m.name_en : m.name_th);

  if (loading) return <MenuSkeleton />;
  if (error || !data) return (
    <div className="min-h-screen grid place-items-center p-6 text-center">
      <div>
        <div className="text-4xl mb-3">😕</div>
        <p className="text-destructive font-medium">{error ?? "Not found"}</p>
        <button onClick={() => location.reload()} className="mt-4 text-sm text-primary underline">Try again</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* ── Header ── */}
      <header className="sticky top-0 z-20 bg-card/95 backdrop-blur border-b">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground">{data.restaurant_name}</div>
            <div className="font-semibold truncate">{tr.table} {data.table.code}</div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setLang(lang === "th" ? "en" : "th")} className="gap-1 shrink-0">
            <Languages className="h-4 w-4" />{lang === "th" ? "EN" : "TH"}
          </Button>
        </div>
        {/* Category tabs — scrollable, active tab snaps to center */}
        <div ref={catBarRef} className="max-w-2xl mx-auto px-2 pb-2 overflow-x-auto scrollbar-none">
          <div className="flex gap-2 px-2 w-max">
            <Button data-cat="all" size="sm" variant={activeCat === "all" ? "default" : "outline"} onClick={() => switchCat("all")} className="rounded-full">
              {tr.all}
            </Button>
            {data.categories.map((c) => (
              <Button data-cat={c.id} key={c.id} size="sm" variant={activeCat === c.id ? "default" : "outline"} onClick={() => switchCat(c.id)} className="whitespace-nowrap rounded-full">
                {name(c)}
              </Button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Menu grid ── */}
      <main className="max-w-2xl mx-auto px-4 py-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {filtered.length === 0 && (
          <p className="col-span-2 text-center text-muted-foreground py-12">{lang === "th" ? "ไม่มีเมนูในหมวดนี้" : "No items in this category"}</p>
        )}
        {filtered.map((m) => (
          <button
            key={m.id}
            onClick={() => openAdd(m)}
            className="text-left bg-card border rounded-xl p-3 active:scale-[0.98] transition-transform flex gap-3 hover:border-primary/40"
          >
            {m.image_url ? <MenuImage src={m.image_url} /> : <PlaceholderImg />}
            <div className="min-w-0 flex-1">
              <div className="font-medium leading-tight line-clamp-2">{name(m)}</div>
              <div className="text-xs text-muted-foreground truncate mt-0.5">{sub(m)}</div>
              <div className="mt-1.5 font-bold text-primary">฿{Number(m.price).toFixed(0)}</div>
            </div>
          </button>
        ))}
      </main>

      {/* ── Cart bar ── */}
      <Sheet>
        <SheetTrigger asChild>
          <button
            className="fixed bottom-4 left-4 right-4 max-w-2xl mx-auto bg-primary text-primary-foreground rounded-full shadow-lg px-5 py-3 flex items-center gap-3 disabled:opacity-40 transition-opacity"
            disabled={cartCount === 0}
          >
            <ShoppingCart className="h-5 w-5 shrink-0" />
            <span className="font-medium min-w-0 truncate">
              {cartCount > 0 ? `${cartCount} · ${tr.cart}` : tr.empty}
            </span>
            <span className="ml-auto font-bold shrink-0">฿{cartTotal.toFixed(0)}</span>
          </button>
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-auto">
          <SheetHeader><SheetTitle>{tr.cart}</SheetTitle></SheetHeader>
          <div className="space-y-2 mt-3">
            {cart.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">{tr.empty}</p>}
            {cart.map((c, i) => {
              const sc = c.set_config;
              return (
                <div key={i} className={`flex items-start gap-2 border rounded-lg p-3 ${sc ? "border-amber-200 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20" : ""}`}>
                  <div className="flex-1 min-w-0">
                    {sc ? (
                      <>
                        <div className="font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                          <Layers className="h-3.5 w-3.5 shrink-0" />{name(c)}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 space-y-0.5 pl-5">
                          <div>🍽️ {sc.main.th}</div>
                          {sc.sides.map((s, si) => <div key={si}>🥗 {s.th}</div>)}
                          {sc.drink && <div>🥤 {sc.drink.th} <span className="text-amber-600 font-semibold">{tr.set_free}</span></div>}
                          <div>🍚 {sc.rice === "rice" ? tr.set_steamed : tr.set_porridge}</div>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 pl-5">฿{c.price.toFixed(0)}</div>
                      </>
                    ) : (
                      <>
                        <div className="font-medium">{name(c)}</div>
                        {c.addons && c.addons.length > 0 && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {c.addons.map((a) => `+ ${a.option_name}${a.price > 0 ? ` (+฿${a.price})` : ""}`).join(" · ")}
                          </div>
                        )}
                        {c.notes && <div className="text-xs text-muted-foreground">📝 {c.notes}</div>}
                        <div className="text-xs text-muted-foreground mt-0.5">฿{c.price.toFixed(0)} × {c.qty}</div>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => updateQty(i, -1)}><Minus className="h-3.5 w-3.5" /></Button>
                    {!sc && <span className="w-6 text-center font-medium tabular-nums">{c.qty}</span>}
                    {!sc && <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => updateQty(i, 1)}><Plus className="h-3.5 w-3.5" /></Button>}
                  </div>
                </div>
              );
            })}
          </div>
          {cart.length > 0 && (
            <div className="mt-4 space-y-3 sticky bottom-0 bg-background pt-3 border-t">
              <div className="flex justify-between font-bold text-lg">
                <span>{tr.total}</span><span>฿{cartTotal.toFixed(0)}</span>
              </div>
              <Button className="w-full" size="lg" onClick={() => setConfirmOpen(true)}>
                <Check className="h-4 w-4 mr-1" />{tr.submit}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Add item dialog (regular items only) ── */}
      <Dialog open={!!adding} onOpenChange={(o) => !o && setAdding(null)}>
        <DialogContent className="overflow-hidden">
          {adding?.image_url && <PopupHeroImage src={adding.image_url} />}
          <DialogHeader>
            <DialogTitle className="leading-snug">{adding ? name(adding) : ""}</DialogTitle>
            {adding && <p className="text-sm text-muted-foreground mt-0.5">{sub(adding)}</p>}
          </DialogHeader>
          {adding && (() => {
            const addonGroups: AddonGroup[] = data?.addonsByMenuId?.[adding.id] ?? [];
            const addonTotal = Array.from(selectedAddons.values()).reduce((s, a) => s + a.price, 0);
            const totalPrice = (adding.price + addonTotal) * addQty;
            return (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-bold text-primary">฿{totalPrice.toFixed(0)}</span>
                  <div className="flex items-center gap-3">
                    <Button variant="outline" size="icon" className="h-10 w-10 rounded-full" onClick={() => setAddQty(Math.max(1, addQty - 1))}>
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="text-xl font-bold tabular-nums w-6 text-center">{addQty}</span>
                    <Button variant="outline" size="icon" className="h-10 w-10 rounded-full" onClick={() => setAddQty(addQty + 1)}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* ── Add-on groups ── */}
                {addonGroups.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{tr.add_ons}</p>
                    {addonGroups.map((group) => {
                      const chosen = selectedAddons.get(group.id);
                      return (
                        <div key={group.id}>
                          <p className="text-sm font-medium mb-1.5">{group.name}</p>
                          <div className="flex flex-wrap gap-2">
                            {group.addon_options.map((opt) => {
                              const isSelected = chosen?.option_id === opt.id;
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedAddons((prev) => {
                                      const next = new Map(prev);
                                      if (isSelected) {
                                        next.delete(group.id);
                                      } else {
                                        next.set(group.id, {
                                          group_id: group.id,
                                          group_name: group.kitchen_name ?? group.name,
                                          option_id: opt.id,
                                          option_name: opt.name,
                                          price: opt.price,
                                        });
                                      }
                                      return next;
                                    });
                                  }}
                                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors
                                    ${isSelected
                                      ? "border-primary bg-primary text-primary-foreground font-medium"
                                      : "border-border hover:border-primary/60 hover:bg-muted/50"}`}
                                >
                                  {opt.name}{opt.price > 0 && ` +฿${opt.price}`}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div>
                  <Label className="text-sm text-muted-foreground">{tr.notes}</Label>
                  <Textarea
                    value={addNotes}
                    onChange={(e) => setAddNotes(e.target.value)}
                    placeholder={lang === "th" ? "ไม่เผ็ด, ไม่ใส่ผัก…" : "no spicy, no veg…"}
                    rows={2}
                    className="mt-1 resize-none"
                  />
                </div>
              </div>
            );
          })()}
          <DialogFooter className="gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setAdding(null)}>{tr.cancel}</Button>
            <Button className="flex-1" onClick={addToCart}>
              {tr.add} · ฿{adding ? ((adding.price + Array.from(selectedAddons.values()).reduce((s, a) => s + a.price, 0)) * addQty).toFixed(0) : "0"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Set menu dialog ── */}
      {selectedSetDef && (
        <QrSetDialog
          key={selectedSetDef.id}
          setDef={selectedSetDef}
          lang={lang}
          tr={tr}
          onClose={() => { setSelectedSetDef(null); setSetMenuOrigin(null); }}
          onConfirm={addSetToCart}
        />
      )}

      {/* ── Confirm order dialog ── */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{tr.confirm}</DialogTitle></DialogHeader>
          <div className="space-y-1 text-sm max-h-60 overflow-y-auto">
            {cart.map((c, i) => {
              const sc = c.set_config;
              return (
                <div key={i} className="flex justify-between gap-2">
                  <span className="min-w-0">
                    {sc && <Layers className="inline h-3.5 w-3.5 mr-1 text-amber-600" />}
                    {name(c)} × {c.qty}
                    {sc && (
                      <span className="block text-xs text-muted-foreground pl-5">
                        {sc.main.th} · {sc.sides.map(s => s.th).join(", ")}
                        {sc.drink ? ` · ${sc.drink.th}` : ""}
                        {" · "}{sc.rice === "rice" ? "ข้าวสวย" : "โจ๊ก"}
                      </span>
                    )}
                    {!sc && c.addons && c.addons.length > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        {c.addons.map((a) => `+ ${a.option_name}`).join(" · ")}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0">฿{(c.price * c.qty).toFixed(0)}</span>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between font-bold text-lg border-t pt-2">
            <span>{tr.total}</span><span>฿{cartTotal.toFixed(0)}</span>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmOpen(false)} disabled={submitting}>{tr.cancel}</Button>
            <Button className="flex-1" onClick={submit} disabled={submitting}>
              {submitting ? "…" : tr.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Order sent dialog ── */}
      <Dialog open={submitted} onOpenChange={setSubmitted}>
        <DialogContent className="text-center">
          <div className="text-5xl py-2">✅</div>
          <DialogHeader><DialogTitle>{lang === "th" ? "ส่งสำเร็จ!" : "Order sent!"}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{tr.thanks}</p>
          <Button className="w-full mt-2" onClick={() => setSubmitted(false)}>{tr.order_more}</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
