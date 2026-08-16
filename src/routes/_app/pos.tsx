import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { CountKeypad } from "@/components/CountKeypad";
import { Bell, Users, X, ShoppingBag, UtensilsCrossed, Plus, QrCode } from "lucide-react";
import { toast } from "sonner";
import { playAlertBeep } from "@/lib/audio-alert";
import { printCounter } from "@/lib/counter-printer";
import { isOffline } from "@/lib/online-status";

export const Route = createFileRoute("/_app/pos")({ component: PosPage });

type RTable = {
  id: string; code: string; capacity: number;
  status: "available" | "occupied" | "bill_requested";
  guests: number; pos_x: number; pos_y: number; has_qr_alert: boolean; is_test?: boolean;
};

type SpecialOrder = {
  id: string;
  order_number: string | null;
  source: "takeout" | "staff_meal";
};

function PosPage() {
  const { t } = useI18n();
  const { staff } = useAuth();
  const nav = useNavigate();
  const [tables, setTables] = useState<RTable[]>([]);
  const [openTable, setOpenTable] = useState<RTable | null>(null);
  const [guests, setGuests] = useState(2);
  const [banner, setBanner] = useState<{ tableCode: string; key: number } | null>(null);
  const [specialOrders, setSpecialOrders] = useState<SpecialOrder[]>([]);

  const load = async () => {
    const { data } = await supabase.from("restaurant_tables").select("*").order("code");
    if (data) setTables(data as RTable[]);
  };

  const loadSpecialOrders = async () => {
    const { data } = await supabase
      .from("orders")
      .select("id,order_number,source")
      .in("source", ["takeout", "staff_meal"])
      .eq("status", "open")
      .order("created_at");
    if (data) setSpecialOrders(data as SpecialOrder[]);
  };

  useEffect(() => {
    load();
    loadSpecialOrders();
    const showQrAlert = (tableCode: string) => {
      toast.success(`${t("qr_alert")} — ${t("table")} ${tableCode}`);
      playAlertBeep();
      setBanner({ tableCode, key: Date.now() });
    };
    const ch = supabase
      .channel("tables-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_tables" }, (payload) => {
        load();
        const next = payload.new as Partial<RTable> | null;
        const prev = payload.old as Partial<RTable> | null;
        if (next?.has_qr_alert && !prev?.has_qr_alert) {
          showQrAlert(next.code ?? "?");
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => loadSpecialOrders())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [t]);

  // Auto-dismiss banner after 8s
  useEffect(() => {
    if (!banner) return;
    const id = setTimeout(() => setBanner(null), 8000);
    return () => clearTimeout(id);
  }, [banner]);

  const onTableClick = async (tbl: RTable) => {
    if (tbl.status === "available") {
      setOpenTable(tbl);
      setGuests(0); // keypad starts empty so the tapped number lands directly
    } else {
      // Use limit(1) + data?.[0] instead of maybeSingle() so that duplicate
      // open orders (e.g. from a previous crashed session) don't return null.
      // IMPORTANT: orders table uses "opened_at", not "created_at".
      const { data: orders, error: orderErr } = await supabase
        .from("orders")
        .select("id")
        .eq("table_id", tbl.id)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1);
      if (orderErr) {
        toast.error(orderErr.message);
        return;
      }
      const order = orders?.[0] ?? null;
      if (order) {
        nav({ to: "/order/$orderId", params: { orderId: order.id } });
      } else {
        toast.error(t("no_open_order"));
      }
    }
  };

  // Ensure a shift, open an order for the table, mark it occupied. Returns order id.
  const openTableOrder = async (): Promise<string | null> => {
    if (!openTable || !staff) return null;
    if (isOffline()) { toast.error(t("err_offline")); return null; }
    let { data: shift } = await supabase.from("shifts").select("id").eq("status", "open").maybeSingle();
    if (!shift) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: cfg } = await supabase.from("settings").select("starting_cash").eq("id", 1).maybeSingle();
      const opening = Number((cfg as { starting_cash?: number } | null)?.starting_cash ?? 0);
      const { data: newShift } = await supabase.from("shifts").insert({ business_day: today, opened_by: staff.id, opening_float: opening }).select("id").single();
      shift = newShift;
    }
    const { data: order, error } = await supabase.from("orders").insert({
      table_id: openTable.id, guests, opened_by: staff.id, shift_id: shift?.id, source: "pos",
      is_test: openTable.is_test ?? openTable.code === "TEST",
    }).select("id").single();
    if (error || !order) { toast.error(error?.message || "Failed"); return null; }
    await supabase.from("restaurant_tables").update({ status: "occupied", guests }).eq("id", openTable.id);
    return order.id;
  };

  const startTable = async () => {
    const id = await openTableOrder();
    if (!id) return;
    setOpenTable(null);
    nav({ to: "/order/$orderId", params: { orderId: id } });
  };

  // Open the table + print a QR slip for the guest to scan and self-order.
  const printTableQr = async () => {
    const code = openTable?.code;
    const seats = guests;
    const id = await openTableOrder();
    if (!id || !code) return;
    const { data: cfg } = await supabase.from("settings").select("restaurant_name").eq("id", 1).maybeSingle();
    await printCounter({
      kind: "table_qr",
      table: code,
      url: `${window.location.origin}/menu/${encodeURIComponent(code)}`,
      restaurant: (cfg as { restaurant_name?: string } | null)?.restaurant_name ?? "Restaurant",
      guests: seats,
    });
    toast.success(`QR printed · ${t("table")} ${code}`);
    setOpenTable(null);
  };

  const createSpecialOrder = async (source: "takeout" | "staff_meal") => {
    if (!staff) return;
    if (isOffline()) { toast.error(t("err_offline")); return; }
    // Ensure shift is open
    let { data: shift } = await supabase.from("shifts").select("id").eq("status", "open").maybeSingle();
    if (!shift) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: cfg } = await supabase.from("settings").select("starting_cash").eq("id", 1).maybeSingle();
      const opening = Number((cfg as { starting_cash?: number } | null)?.starting_cash ?? 0);
      const { data: newShift } = await supabase.from("shifts").insert({ business_day: today, opened_by: staff.id, opening_float: opening }).select("id").single();
      shift = newShift;
    }
    // Count all existing orders of this source to determine next number
    const { count } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("source", source);
    const nextNum = (count ?? 0) + 1;
    const prefix = source === "takeout" ? "TO" : "ST";
    const orderNumber = `${prefix}-${String(nextNum).padStart(3, "0")}`;

    const { data: order, error } = await (supabase.from("orders") as any).insert({
      opened_by: staff.id,
      shift_id: shift?.id,
      source,
      order_number: orderNumber,
    }).select("id").single();

    if (error || !order) { toast.error(error?.message || "Failed to create order"); return; }
    nav({ to: "/order/$orderId", params: { orderId: order.id } });
  };

  const colorFor = (s: RTable["status"]) =>
    s === "available" ? "bg-table-available text-white"
    : s === "bill_requested" ? "bg-table-bill text-white"
    : "bg-table-occupied text-white";

  const takeoutOrders = specialOrders.filter((o) => o.source === "takeout");
  const staffOrders = specialOrders.filter((o) => o.source === "staff_meal");

  return (
    <div className="p-6">
      {banner && (
        <div
          key={banner.key}
          className="alert-banner sticky top-14 z-20 mb-4 flex items-center gap-3 rounded-xl border border-destructive bg-destructive px-4 py-3 text-destructive-foreground shadow-lg"
          role="alert"
        >
          <Bell className="h-5 w-5 animate-pulse" />
          <div className="font-semibold">
            {t("qr_alert")} — {t("table")} {banner.tableCode}
          </div>
          <button
            onClick={() => setBanner(null)}
            className="ml-auto rounded p-1 hover:bg-black/10"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Special Orders Section */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Takeout */}
        <div className="rounded-xl border-2 border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span className="font-semibold text-blue-700 dark:text-blue-300 text-sm">{t("takeout")}</span>
              {takeoutOrders.length > 0 && (
                <span className="text-xs bg-blue-200 dark:bg-blue-800 text-blue-700 dark:text-blue-300 rounded-full px-1.5 py-0.5 font-medium">
                  {takeoutOrders.length}
                </span>
              )}
            </div>
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white h-8 px-3 text-xs"
              onClick={() => createSpecialOrder("takeout")}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />{t("new_order_btn")}
            </Button>
          </div>
          {takeoutOrders.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {takeoutOrders.map((o) => (
                <button
                  key={o.id}
                  onClick={() => nav({ to: "/order/$orderId", params: { orderId: o.id } })}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold shadow-sm transition-colors"
                >
                  {o.order_number ?? "TO-?"}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-blue-500 dark:text-blue-400 opacity-70">{t("no_takeout_orders")}</p>
          )}
        </div>

        {/* Staff Meal */}
        <div className="rounded-xl border-2 border-purple-200 bg-purple-50 dark:bg-purple-950/30 dark:border-purple-800 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <UtensilsCrossed className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              <span className="font-semibold text-purple-700 dark:text-purple-300 text-sm">{t("staff_meal")}</span>
              {staffOrders.length > 0 && (
                <span className="text-xs bg-purple-200 dark:bg-purple-800 text-purple-700 dark:text-purple-300 rounded-full px-1.5 py-0.5 font-medium">
                  {staffOrders.length}
                </span>
              )}
            </div>
            <Button
              size="sm"
              className="bg-purple-600 hover:bg-purple-700 text-white h-8 px-3 text-xs"
              onClick={() => createSpecialOrder("staff_meal")}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />{t("new_order_btn")}
            </Button>
          </div>
          {staffOrders.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {staffOrders.map((o) => (
                <button
                  key={o.id}
                  onClick={() => nav({ to: "/order/$orderId", params: { orderId: o.id } })}
                  className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold shadow-sm transition-colors"
                >
                  {o.order_number ?? "ST-?"}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-purple-500 dark:text-purple-400 opacity-70">{t("no_staff_meal_orders")}</p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">{t("nav_pos")}</h1>
        <div className="flex items-center gap-3 text-sm">
          <Legend color="bg-table-available" label={t("available")} />
          <Legend color="bg-table-occupied" label={t("occupied")} />
          <Legend color="bg-table-bill" label={t("bill_requested")} />
        </div>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3">
        {tables.map((tbl) => (
          <button
            key={tbl.id}
            onClick={() => onTableClick(tbl)}
            className={`relative aspect-square rounded-xl shadow-sm hover:shadow-md transition-all ${tbl.has_qr_alert ? "alert-flash" : (tbl.is_test ?? tbl.code === "TEST") ? "bg-black text-white ring-2 ring-neutral-500" : colorFor(tbl.status)} flex flex-col items-center justify-center gap-1 p-2`}
          >
            {tbl.has_qr_alert && (
              <>
                <span className="absolute top-1.5 right-1.5">
                  <Bell className="h-4 w-4 animate-pulse" />
                </span>
                <span className="absolute -top-1.5 -left-1.5 inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-white text-destructive text-[11px] font-bold shadow">
                  NEW
                </span>
              </>
            )}
            <div className="text-2xl font-bold leading-none">{tbl.code}</div>
            <div className="text-xs opacity-90">{tbl.capacity}</div>
            {tbl.status !== "available" && (
              <div className="flex items-center gap-1 text-sm mt-1">
                <Users className="h-3.5 w-3.5" /> {tbl.guests}
              </div>
            )}
          </button>
        ))}
      </div>

      <Dialog open={!!openTable} onOpenChange={(o) => !o && setOpenTable(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("open_table")} — {openTable?.code}</DialogTitle></DialogHeader>
          <div>
            <Label>{t("num_guests")}</Label>
            <div className="mt-2">
              <CountKeypad value={guests} onChange={setGuests} />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setOpenTable(null)}>{t("cancel")}</Button>
            <Button variant="outline" onClick={printTableQr} disabled={guests < 1}>
              <QrCode className="h-4 w-4 mr-1" />Print QR
            </Button>
            <Button onClick={startTable} disabled={guests < 1}>{t("start")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-block h-3 w-3 rounded ${color}`} />
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}
