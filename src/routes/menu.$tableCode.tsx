import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ShoppingCart, Plus, Minus, Check, Languages } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/menu/$tableCode")({
  component: CustomerMenu,
  head: () => ({
    meta: [
      { title: "Menu" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
    ],
  }),
});

type Menu = { id: string; category_id: string | null; name_th: string; name_en: string; price: number; image_url: string | null };
type Category = { id: string; name_th: string; name_en: string };
type CartItem = { menu_id: string; name_th: string; name_en: string; price: number; qty: number; notes?: string };
type Lang = "th" | "en";

const T = {
  th: { menu: "เมนู", table: "โต๊ะ", cart: "ตะกร้า", add: "เพิ่ม", submit: "ส่งออเดอร์", qty: "จำนวน", notes: "หมายเหตุ", empty: "ยังไม่มีรายการ", total: "รวม", confirm: "ยืนยันสั่ง", cancel: "ยกเลิก", thanks: "ขอบคุณค่ะ! ออเดอร์ของคุณกำลังรอพนักงานยืนยัน", order_more: "สั่งเพิ่ม", all: "ทั้งหมด" },
  en: { menu: "Menu", table: "Table", cart: "Cart", add: "Add", submit: "Submit order", qty: "Qty", notes: "Notes", empty: "Cart is empty", total: "Total", confirm: "Place order", cancel: "Cancel", thanks: "Thank you! Your order is waiting for staff confirmation.", order_more: "Order more", all: "All" },
};

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

// ── Main component ────────────────────────────────────────────────────────────
function CustomerMenu() {
  const { tableCode } = Route.useParams();
  const [lang, setLang] = useState<Lang>("th");
  const [data, setData] = useState<{ table: { id: string; code: string }; categories: Category[]; menus: Menu[]; restaurant_name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState<string | "all">("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [adding, setAdding] = useState<Menu | null>(null);
  const [addQty, setAddQty] = useState(1);
  const [addNotes, setAddNotes] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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

  const filtered = useMemo(() => {
    if (!data) return [];
    return activeCat === "all" ? data.menus : data.menus.filter((m) => m.category_id === activeCat);
  }, [data, activeCat]);

  const cartTotal = useMemo(() => cart.reduce((s, c) => s + c.qty * c.price, 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((s, c) => s + c.qty, 0), [cart]);

  const openAdd = (m: Menu) => { setAdding(m); setAddQty(1); setAddNotes(""); };
  const addToCart = () => {
    if (!adding) return;
    setCart((prev) => [...prev, { menu_id: adding.id, name_th: adding.name_th, name_en: adding.name_en, price: adding.price, qty: addQty, notes: addNotes || undefined }]);
    setAdding(null);
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
          items: cart.map((c) => ({ menu_id: c.menu_id, qty: c.qty, notes: c.notes ?? null })),
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
            {cart.map((c, i) => (
              <div key={i} className="flex items-start gap-2 border rounded-lg p-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{name(c)}</div>
                  {c.notes && <div className="text-xs text-muted-foreground">📝 {c.notes}</div>}
                  <div className="text-xs text-muted-foreground mt-0.5">฿{c.price.toFixed(0)} × {c.qty}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => updateQty(i, -1)}><Minus className="h-3.5 w-3.5" /></Button>
                  <span className="w-6 text-center font-medium tabular-nums">{c.qty}</span>
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => updateQty(i, 1)}><Plus className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            ))}
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

      {/* ── Add item dialog ── */}
      <Dialog open={!!adding} onOpenChange={(o) => !o && setAdding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="leading-snug">{adding ? name(adding) : ""}</DialogTitle>
            {adding && <p className="text-sm text-muted-foreground mt-0.5">{sub(adding)}</p>}
          </DialogHeader>
          {adding && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold text-primary">฿{(adding.price * addQty).toFixed(0)}</span>
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
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setAdding(null)}>{tr.cancel}</Button>
            <Button className="flex-1" onClick={addToCart}>{tr.add}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Confirm order dialog ── */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{tr.confirm}</DialogTitle></DialogHeader>
          <div className="space-y-1 text-sm">
            {cart.map((c, i) => (
              <div key={i} className="flex justify-between">
                <span>{name(c)} × {c.qty}</span>
                <span>฿{(c.price * c.qty).toFixed(0)}</span>
              </div>
            ))}
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
