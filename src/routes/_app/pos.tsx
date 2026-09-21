import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { CountKeypad } from "@/components/CountKeypad";
import { ManagerPinDialog } from "@/components/ManagerPinDialog";
import { Bell, Users, X, ShoppingBag, UtensilsCrossed, Plus, QrCode, Merge } from "lucide-react";
import { toast } from "sonner";
import { playAlertBeep } from "@/lib/audio-alert";
import { printCounter } from "@/lib/counter-printer";
import { isOffline } from "@/lib/online-status";
import { tableLabel } from "@/lib/table";
import { publicBaseUrl } from "@/lib/public-url";

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

type CombineOption = {
  orderId: string;
  tableId: string;
  code: string;
  guests: number;
  subtotal: number;
};

function PosPage() {
  const { t, lang } = useI18n();
  const { staff } = useAuth();
  const nav = useNavigate();
  const [tables, setTables] = useState<RTable[]>([]);
  const [openOrderByTable, setOpenOrderByTable] = useState<Record<string, string>>({});
  const [openTable, setOpenTable] = useState<RTable | null>(null);
  const [guests, setGuests] = useState(2);
  const [banner, setBanner] = useState<{ tableCode: string; key: number } | null>(null);
  const [specialOrders, setSpecialOrders] = useState<SpecialOrder[]>([]);
  // Table view filter: show all tables, only free ones, or only in-use ones (MERI-style).
  const [tableFilter, setTableFilter] = useState<"all" | "available" | "occupied">("all");
  const [combineOpen, setCombineOpen] = useState(false);
  const [combineOptions, setCombineOptions] = useState<CombineOption[]>([]);
  const [combineSelected, setCombineSelected] = useState<string[]>([]);
  const [combineTargetId, setCombineTargetId] = useState<string | null>(null);
  const [combineBusy, setCombineBusy] = useState(false);
  const [combinePinOpen, setCombinePinOpen] = useState(false);

  const load = async () => {
    const [{ data }, { data: openOrders }] = await Promise.all([
      supabase.from("restaurant_tables").select("*").order("code"),
      supabase.from("orders").select("id,table_id,opened_at").eq("status", "open").not("table_id", "is", null).order("opened_at", { ascending: false }),
    ]);
    if (data) setTables(data as RTable[]);
    const map: Record<string, string> = {};
    for (const order of openOrders ?? []) if (order.table_id && !map[order.table_id]) map[order.table_id] = order.id;
    setOpenOrderByTable(map);
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
      toast.success(`${t("qr_alert")} — ${t("table")} ${tableLabel(tableCode)}`);
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
      const prefetched = openOrderByTable[tbl.id];
      if (prefetched) {
        nav({ to: "/order/$orderId", params: { orderId: prefetched } });
        return;
      }
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

  // Open an order for the table (requires an open register/shift).
  const openTableOrder = async (): Promise<string | null> => {
    if (!openTable || !staff) return null;
    if (isOffline()) { toast.error(t("err_offline")); return null; }
    const { data: shift } = await supabase.from("shifts").select("id").eq("status", "open").maybeSingle();
    if (!shift) {
      // No shift open — staff must open the register (count starting cash) first.
      toast.error(t("rep_open_register_first"));
      setOpenTable(null);
      nav({ to: "/register" });
      return null;
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
    await printCounter({
      kind: "table_qr",
      table: tableLabel(code),
      url: `${publicBaseUrl()}/menu/${encodeURIComponent(code)}`,
      // The queue bridge prints this as native ESC/POS text. Keep it ASCII:
      // this counter printer's firmware corrupts Thai text in that mode.
      restaurant: "LONMOH",
      guests: seats,
    });
    toast.success(`QR printed · ${t("table")} ${tableLabel(code)}`);
    setOpenTable(null);
  };

  const createSpecialOrder = async (source: "takeout" | "staff_meal") => {
    if (!staff) return;
    if (isOffline()) { toast.error(t("err_offline")); return; }
    // Requires an open register/shift.
    const { data: shift } = await supabase.from("shifts").select("id").eq("status", "open").maybeSingle();
    if (!shift) {
      toast.error(t("rep_open_register_first"));
      nav({ to: "/register" });
      return;
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

  const openCombine = async () => {
    const { data, error } = await (supabase as any)
      .from("orders")
      .select("id,table_id,guests,restaurant_tables!inner(id,code,status),order_items(qty,unit_price,status)")
      .eq("status", "open")
      .not("table_id", "is", null);
    if (error) { toast.error(error.message); return; }
    const options = (data ?? []).map((row: any) => ({
      orderId: row.id,
      tableId: row.table_id,
      code: row.restaurant_tables?.code ?? "",
      guests: Number(row.guests ?? 0),
      subtotal: (row.order_items ?? [])
        .filter((item: any) => item.status !== "voided")
        .reduce((sum: number, item: any) => sum + Number(item.qty) * Number(item.unit_price), 0),
    })).filter((row: CombineOption) => row.code)
      .sort((a: CombineOption, b: CombineOption) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    if (options.length < 2) {
      toast.info(lang === "th" ? "ต้องมีโต๊ะที่กำลังใช้งานอย่างน้อย 2 โต๊ะ" : "At least two serving tables are required");
      return;
    }
    setCombineOptions(options);
    setCombineSelected([]);
    setCombineTargetId(null);
    setCombineOpen(true);
  };

  const toggleCombineTable = (orderId: string) => {
    setCombineSelected((current) => {
      if (current.includes(orderId)) {
        const next = current.filter((id) => id !== orderId);
        if (combineTargetId === orderId) setCombineTargetId(next[0] ?? null);
        return next;
      }
      if (current.length >= 2) return current;
      const next = [...current, orderId];
      if (next.length === 2 && !combineTargetId) setCombineTargetId(next[0]);
      return next;
    });
  };

  const combineChosenTables = async () => {
    if (combineSelected.length !== 2 || !combineTargetId || combineBusy) return;
    const sourceOrderId = combineSelected.find((id) => id !== combineTargetId);
    if (!sourceOrderId) return;
    setCombineBusy(true);
    const { data, error } = await (supabase as any).rpc("combine_open_table_orders", {
      p_target_order_id: combineTargetId,
      p_source_order_id: sourceOrderId,
      p_merged_by: staff?.id ?? null,
    });
    setCombineBusy(false);
    if (error) {
      toast.error(error.message.includes("payment, member points, or discounts")
        ? (lang === "th" ? "รวมไม่ได้: เริ่มชำระเงิน ใช้แต้ม หรือส่วนลดแล้ว" : "Cannot combine: payment, points, or a discount has already started")
        : error.message);
      return;
    }
    const target = combineOptions.find((x) => x.orderId === combineTargetId);
    const result = data?.[0];
    setCombineOpen(false);
    setCombineSelected([]);
    setCombineTargetId(null);
    await load();
    toast.success(lang === "th"
      ? `รวมโต๊ะแล้ว · ชำระที่โต๊ะ ${tableLabel(target?.code)} · ${result?.combined_guests ?? ""} คน`
      : `Tables combined · Pay at table ${tableLabel(target?.code)} · ${result?.combined_guests ?? ""} guests`);
  };

  const requestCombine = () => {
    if (combineSelected.length !== 2 || !combineTargetId) return;
    if (staff?.role === "staff") setCombinePinOpen(true);
    else void combineChosenTables();
  };

  const takeoutOrders = specialOrders.filter((o) => o.source === "takeout");
  const staffOrders = specialOrders.filter((o) => o.source === "staff_meal");
  const availCount = tables.filter((x) => x.status === "available").length;
  const busyCount = tables.length - availCount;
  const visibleTables = tables.filter((x) =>
    tableFilter === "available" ? x.status === "available"
    : tableFilter === "occupied" ? x.status !== "available"
    : true,
  );
  // Real tables render on the floor map; only TEST drops to the "Other" row
  // (alongside the takeout / staff-meal tiles).
  const isExtraTable = (tbl: RTable) => tbl.is_test ?? tbl.code === "TEST";
  const floorTables = visibleTables.filter((x) => !isExtraTable(x));
  const extraTables = visibleTables.filter(isExtraTable);

  const renderTable = (tbl: RTable, placed: boolean) => {
    const isTest = tbl.is_test ?? tbl.code === "TEST";
    const bill = tbl.status === "bill_requested";
    const busy = tbl.status !== "available";
    const ink = isTest ? "text-white" : "text-foreground";
    return (
      <button
        key={tbl.id}
        onClick={() => onTableClick(tbl)}
        style={placed ? { gridColumnStart: (tbl.pos_x ?? 0) + 1, gridRowStart: (tbl.pos_y ?? 0) + 1 } : undefined}
        className={`tbl-card relative aspect-square rounded-2xl p-3 shadow-sm hover:shadow-md transition-all flex flex-col ${!placed ? "w-32 shrink-0" : ""} ${tbl.has_qr_alert ? "alert-flash" : isTest ? "tbl-test" : bill ? "tbl-bill" : busy ? "tbl-occupied" : ""}`}
      >
        {tbl.has_qr_alert && (
          <>
            <span className="absolute top-1.5 right-1.5"><Bell className="h-4 w-4 animate-pulse" /></span>
            <span className="absolute -top-1.5 -left-1.5 inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-white text-destructive text-[11px] font-bold shadow">NEW</span>
          </>
        )}
        <div className="flex items-start justify-between">
          <span className={`text-2xl font-extrabold leading-none ${ink}`}>{tableLabel(tbl.code)}</span>
          {bill && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-destructive text-destructive-foreground leading-none">{t("bill_requested")}</span>
          )}
        </div>
        <div className="flex-1 grid place-items-center">
          {busy ? (
            <div className={`flex items-center gap-1.5 ${ink}`}>
              <Users className="h-5 w-5" />
              <span className="text-3xl font-bold leading-none">{tbl.guests}</span>
            </div>
          ) : (
            <span className="grid place-items-center h-12 w-12 rounded-full bg-primary/15 text-primary">
              <Plus className="h-7 w-7" />
            </span>
          )}
        </div>
        <div className={`flex items-center gap-1 text-xs ${isTest ? "text-white/75" : "text-muted-foreground"}`}>
          <Users className="h-3.5 w-3.5" /> {tbl.capacity}
        </div>
      </button>
    );
  };

  return (
    <div className="pos-surface min-h-[calc(100dvh-3.5rem)] p-6">
      {banner && (
        <div
          key={banner.key}
          className="alert-banner sticky top-14 z-20 mb-4 flex items-center gap-3 rounded-xl border border-destructive bg-destructive px-4 py-3 text-destructive-foreground shadow-lg"
          role="alert"
        >
          <Bell className="h-5 w-5 animate-pulse" />
          <div className="font-semibold">
            {t("qr_alert")} — {t("table")} {tableLabel(banner.tableCode)}
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

      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("nav_pos")}</h1>
        <Button variant="outline" onClick={openCombine}>
          <Merge className="h-4 w-4 mr-1" />{lang === "th" ? "รวมโต๊ะ" : "Combine tables"}
        </Button>
      </div>
      <div className="tbl-floor-wrap">
        <div className="tbl-floor">
          <div className="floor-note floor-note-lg" style={{ gridColumn: "1 / 3", gridRow: 1 }}>{t("floor_entrance")}</div>
          {floorTables.map((tbl) => renderTable(tbl, true))}
          <div className="floor-note floor-note-lg" style={{ gridColumn: "1 / 3", gridRow: 6 }}>{t("floor_cashier")}</div>
          <div className="floor-note floor-note-lg" style={{ gridColumn: "4 / 6", gridRow: 6 }}>{t("floor_fridge")}</div>
        </div>
        {visibleTables.length === 0 && (
          <p className="text-center text-muted-foreground py-10">
            {tableFilter === "occupied" ? t("no_occupied_tables") : t("no_available_tables")}
          </p>
        )}
        <div className="mt-6 mx-auto max-w-[760px]">
          <div className="text-xs font-medium text-muted-foreground mb-2">{t("floor_other")}</div>
          <div className="flex flex-wrap gap-3">
            {extraTables.map((tbl) => renderTable(tbl, false))}
            <button
              onClick={() => createSpecialOrder("takeout")}
              className="tbl-card relative aspect-square rounded-2xl p-3 shadow-sm hover:shadow-md transition-all flex flex-col w-32 shrink-0"
            >
              {takeoutOrders.length > 0 && (
                <span className="absolute -top-1.5 -left-1.5 inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-blue-600 text-white text-[11px] font-bold shadow">{takeoutOrders.length}</span>
              )}
              <div className="flex items-start"><ShoppingBag className="h-5 w-5 text-blue-600" /></div>
              <div className="flex-1 grid place-items-center">
                <span className="grid place-items-center h-12 w-12 rounded-full bg-primary/15 text-primary"><Plus className="h-7 w-7" /></span>
              </div>
              <div className="text-xs font-semibold text-muted-foreground">{t("takeout")}</div>
            </button>
            <button
              onClick={() => createSpecialOrder("staff_meal")}
              className="tbl-card relative aspect-square rounded-2xl p-3 shadow-sm hover:shadow-md transition-all flex flex-col w-32 shrink-0"
            >
              {staffOrders.length > 0 && (
                <span className="absolute -top-1.5 -left-1.5 inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-purple-600 text-white text-[11px] font-bold shadow">{staffOrders.length}</span>
              )}
              <div className="flex items-start"><UtensilsCrossed className="h-5 w-5 text-purple-600" /></div>
              <div className="flex-1 grid place-items-center">
                <span className="grid place-items-center h-12 w-12 rounded-full bg-primary/15 text-primary"><Plus className="h-7 w-7" /></span>
              </div>
              <div className="text-xs font-semibold text-muted-foreground">{t("staff_meal")}</div>
            </button>
          </div>
          {(takeoutOrders.length > 0 || staffOrders.length > 0) && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {takeoutOrders.map((o) => (
                <button key={o.id} onClick={() => nav({ to: "/order/$orderId", params: { orderId: o.id } })} className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold shadow-sm">{o.order_number ?? "TO-?"}</button>
              ))}
              {staffOrders.map((o) => (
                <button key={o.id} onClick={() => nav({ to: "/order/$orderId", params: { orderId: o.id } })} className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold shadow-sm">{o.order_number ?? "ST-?"}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!openTable} onOpenChange={(o) => !o && setOpenTable(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("open_table")} — {tableLabel(openTable?.code)}</DialogTitle></DialogHeader>
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

      <Dialog open={combineOpen} onOpenChange={(open) => { if (!combineBusy) setCombineOpen(open); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{lang === "th" ? "รวมโต๊ะเพื่อชำระครั้งเดียว" : "Combine tables for one payment"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {lang === "th" ? "เลือก 2 โต๊ะ แล้วเลือกว่าจะเก็บโต๊ะใดไว้สำหรับชำระเงิน" : "Choose two tables, then choose which table remains for payment."}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[45vh] overflow-y-auto">
              {combineOptions.map((option) => {
                const selected = combineSelected.includes(option.orderId);
                return (
                  <button
                    key={option.orderId}
                    type="button"
                    onClick={() => toggleCombineTable(option.orderId)}
                    className={`rounded-xl border p-3 text-left transition-colors ${selected ? "border-primary bg-primary/10 ring-2 ring-primary" : "hover:bg-muted/60"}`}
                  >
                    <div className="text-lg font-bold">{lang === "th" ? "โต๊ะ" : "Table"} {tableLabel(option.code)}</div>
                    <div className="text-sm text-muted-foreground">{option.guests} {lang === "th" ? "คน" : "guests"} · ฿{option.subtotal.toFixed(2)}</div>
                  </button>
                );
              })}
            </div>
            {combineSelected.length === 2 && (
              <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
                <Label>{lang === "th" ? "เลือกโต๊ะสำหรับชำระเงิน" : "Choose the payment table"}</Label>
                <div className="grid grid-cols-2 gap-3">
                  {combineSelected.map((id) => {
                    const option = combineOptions.find((x) => x.orderId === id)!;
                    return (
                      <Button key={id} type="button" variant={combineTargetId === id ? "default" : "outline"} onClick={() => setCombineTargetId(id)}>
                        {lang === "th" ? "ชำระที่โต๊ะ" : "Pay at table"} {tableLabel(option.code)}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setCombineOpen(false)} disabled={combineBusy}>{t("cancel")}</Button>
            <Button onClick={requestCombine} disabled={combineSelected.length !== 2 || !combineTargetId || combineBusy}>
              <Merge className="h-4 w-4 mr-1" />{lang === "th" ? "ยืนยันรวมโต๊ะ" : "Confirm combine"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ManagerPinDialog
        open={combinePinOpen}
        onOpenChange={setCombinePinOpen}
        onApproved={() => { void combineChosenTables(); }}
      />
    </div>
  );
}
