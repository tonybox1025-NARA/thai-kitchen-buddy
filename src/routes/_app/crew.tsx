/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ManagerPinDialog } from "@/components/ManagerPinDialog";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import {
  printCounterJobs,
  printKitchenJobs,
  type CounterPrintPayload,
} from "@/lib/counter-printer";
import { Plus, RefreshCw, ShoppingCart, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { tableLabel } from "@/lib/table";

export const Route = createFileRoute("/_app/crew")({ component: CrewPage });

type CrewItem = {
  id: string;
  menu_id: string | null;
  name_th: string;
  name_en: string;
  name_my: string;
  qty: number;
  unit_price: number;
  notes: string | null;
  status: string;
};
type CrewTable = {
  id: string;
  code: string;
  status: "available" | "occupied" | "bill_requested";
  guests: number;
  orderId?: string;
  shiftId?: string | null;
  billStatus?: string | null;
  total: number;
  points: number;
  discount: number;
  memberName?: string | null;
  items: CrewItem[];
};
type TableFilter = "available" | "serving";
const VOID_REASON_KEYS = ["changedMind", "wrongOrder", "other"] as const;
type VoidReasonKey = (typeof VOID_REASON_KEYS)[number];

function CrewPage() {
  const { staff } = useAuth();
  const { lang } = useI18n();
  const c =
    lang === "th"
      ? {
          title: "โต๊ะ",
          subtitle: "สั่งอาหาร · ตรวจบิล · บริการลูกค้า",
          available: "ว่าง",
          serving: "กำลังให้บริการ",
          all: "ทั้งหมด",
          billRequested: "เรียกเก็บเงิน",
          currentTotal: "ยอดปัจจุบัน",
          empty: "ไม่มีโต๊ะในรายการนี้",
          table: "โต๊ะ",
          swipe: "ปัดรายการไปทางซ้ายเพื่อยกเลิก รายการที่ส่งแล้วจะพิมพ์ใบยกเลิก",
          member: "สมาชิก",
          points: "แต้ม",
          rewardDiscount: "ส่วนลดคะแนน",
          total: "รวม",
          addOrder: "สั่งเพิ่ม",
          void: "ยกเลิก",
          paidBlocked: "ไม่สามารถแก้ไขบิลที่ชำระแล้ว",
          alreadyVoided: "รายการนี้ถูกยกเลิกแล้ว",
          auditFailed: "บันทึก VOID ไม่สำเร็จ",
          printFailed: "ยกเลิกรายการแล้ว แต่พิมพ์ใบยกเลิกไม่สำเร็จ",
          voided: "ยกเลิกรายการและบันทึกแล้ว",
          voidTitle: "ยกเลิกรายการ",
          voidHelp: "รายการจะยังอยู่ในรายงาน VOID และไม่ถูกรวมเป็นยอดขายปกติ",
          changedMind: "ลูกค้าเปลี่ยนใจ",
          wrongOrder: "สั่งผิด",
          other: "อื่นๆ",
          enterReason: "ระบุเหตุผล",
          confirmVoid: "ยืนยันยกเลิก",
          voiding: "กำลังยกเลิก…",
          guests: "จำนวนลูกค้า",
          openTable: "เปิดโต๊ะ",
          opening: "กำลังเปิดโต๊ะ…",
          openRegisterFirst: "กรุณาเปิดกะที่แคชเชียร์ก่อน",
        }
      : {
          title: "Tables",
          subtitle: "Order · check bill · assisted service",
          available: "Available",
          serving: "Serving",
          all: "All",
          billRequested: "Bill requested",
          currentTotal: "Current total",
          empty: "No tables in this view",
          table: "Table",
          swipe: "Swipe an item left to void it. Sent items print a cancellation slip.",
          member: "Member",
          points: "points",
          rewardDiscount: "Reward discount",
          total: "Total",
          addOrder: "Order more",
          void: "VOID",
          paidBlocked: "A paid bill cannot be changed",
          alreadyVoided: "This item was already voided",
          auditFailed: "VOID audit failed",
          printFailed: "Item voided, but cancellation print failed",
          voided: "Item voided and recorded",
          voidTitle: "Void item",
          voidHelp: "This stays in the VOID report and cannot be mistaken for a normal sale.",
          changedMind: "Customer changed mind",
          wrongOrder: "Wrong order",
          other: "Other",
          enterReason: "Enter reason",
          confirmVoid: "Confirm VOID",
          voiding: "Voiding…",
          guests: "Number of guests",
          openTable: "Open table",
          opening: "Opening table…",
          openRegisterFirst: "Open the register shift first",
        };
  const [tables, setTables] = useState<CrewTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TableFilter>("available");
  const [openingTable, setOpeningTable] = useState<CrewTable | null>(null);
  const [guestCount, setGuestCount] = useState(1);
  const [opening, setOpening] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [revealedItem, setRevealedItem] = useState<string | null>(null);
  const [voidItem, setVoidItem] = useState<CrewItem | null>(null);
  const [voidPreset, setVoidPreset] = useState<VoidReasonKey>("changedMind");
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const touchStart = useRef(0);

  const selected = tables.find((table) => table.id === selectedId) ?? null;
  const counts = useMemo(
    () => ({
      available: tables.filter((table) => table.status === "available").length,
      serving: tables.filter((table) => table.status !== "available").length,
    }),
    [tables],
  );
  const visibleTables = useMemo(
    () =>
      tables.filter((table) => {
        return filter === "available" ? table.status === "available" : table.status !== "available";
      }),
    [filter, tables],
  );

  const load = async () => {
    setLoading(true);
    const { data: tableRows, error: tableError } = await supabase
      .from("restaurant_tables")
      .select("id,code,status,guests")
      .eq("is_test", false)
      .order("code");
    if (tableError) {
      toast.error(tableError.message);
      setLoading(false);
      return;
    }
    const next = await Promise.all(
      (tableRows ?? []).map(async (table): Promise<CrewTable> => {
        if (table.status === "available")
          return { ...table, status: "available", total: 0, points: 0, discount: 0, items: [] };
        const { data: orderRows } = await supabase
          .from("orders")
          .select("id,shift_id")
          .eq("table_id", table.id)
          .eq("status", "open")
          .order("opened_at", { ascending: false })
          .limit(1);
        const order = orderRows?.[0];
        if (!order)
          return {
            ...table,
            status: table.status as CrewTable["status"],
            total: 0,
            points: 0,
            discount: 0,
            items: [],
          };
        const [{ data: items }, { data: bill }] = await Promise.all([
          supabase
            .from("order_items")
            .select("id,menu_id,name_th,name_en,name_my,qty,unit_price,notes,status")
            .eq("order_id", order.id)
            .neq("status", "voided")
            .order("created_at"),
          (supabase as any)
            .from("bills")
            .select(
              "status,member_id,points_redeemed,loyalty_discount_amount,members(full_name,nickname)",
            )
            .eq("order_id", order.id)
            .maybeSingle(),
        ]);
        const subtotal = (items ?? []).reduce(
          (sum, item) => sum + Number(item.qty) * Number(item.unit_price),
          0,
        );
        return {
          ...table,
          status: table.status as CrewTable["status"],
          orderId: order.id,
          shiftId: order.shift_id,
          billStatus: bill?.status ?? null,
          total: Math.max(0, subtotal - Number(bill?.loyalty_discount_amount ?? 0)),
          points: Number(bill?.points_redeemed ?? 0),
          discount: Number(bill?.loyalty_discount_amount ?? 0),
          memberName: bill?.members?.nickname || bill?.members?.full_name || null,
          items: (items ?? []).map((item) => ({
            ...item,
            qty: Number(item.qty),
            unit_price: Number(item.unit_price),
          })),
        };
      }),
    );
    next.sort((a, b) =>
      tableLabel(a.code).localeCompare(tableLabel(b.code), undefined, { numeric: true }),
    );
    setTables(next);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("crew-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "restaurant_tables" },
        () => void load(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => void load())
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_items" },
        () => void load(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "bills" }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const openOrder = (table: CrewTable) => {
    window.location.href = `/menu/${encodeURIComponent(table.code)}?crew=1`;
  };
  const requestOpenTable = (table: CrewTable) => {
    setGuestCount(1);
    setOpeningTable(table);
  };
  const confirmOpenTable = async () => {
    if (!openingTable || !staff || guestCount < 1 || opening) return;
    setOpening(true);
    const { data: shift, error: shiftError } = await supabase
      .from("shifts")
      .select("id")
      .eq("status", "open")
      .maybeSingle();
    if (shiftError || !shift) {
      toast.error(shiftError?.message || c.openRegisterFirst);
      setOpening(false);
      return;
    }
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        table_id: openingTable.id,
        guests: guestCount,
        opened_by: staff.id,
        shift_id: shift.id,
        source: "pos",
      })
      .select("id")
      .single();
    if (orderError || !order) {
      toast.error(orderError?.message || "Failed to open table");
      setOpening(false);
      return;
    }
    const { error: tableError } = await supabase
      .from("restaurant_tables")
      .update({ status: "occupied", guests: guestCount })
      .eq("id", openingTable.id)
      .eq("status", "available");
    if (tableError) {
      toast.error(tableError.message);
      setOpening(false);
      return;
    }
    const table = openingTable;
    setOpeningTable(null);
    setOpening(false);
    openOrder(table);
  };
  const requestVoid = (item: CrewItem) => {
    if (selected?.billStatus === "paid") {
      toast.error(c.paidBlocked);
      return;
    }
    setVoidPreset("changedMind");
    setVoidReason(c.changedMind);
    setVoidItem(item);
  };
  const confirmVoid = async () => {
    if (!voidItem || !voidReason.trim()) return;
    if (staff?.role === "staff") {
      setManagerOpen(true);
      return;
    }
    await executeVoid();
  };
  const executeVoid = async () => {
    if (!voidItem || !selected?.orderId) return;
    setVoiding(true);
    const now = new Date().toISOString();
    const { data: latest, error: latestError } = await supabase
      .from("order_items")
      .select("status,voided_at")
      .eq("id", voidItem.id)
      .single();
    if (latestError || latest?.status === "voided" || latest?.voided_at) {
      toast.error(c.alreadyVoided);
      setVoiding(false);
      setVoidItem(null);
      await load();
      return;
    }
    const { error: updateError } = await supabase
      .from("order_items")
      .update({
        status: "voided",
        void_reason: voidReason.trim(),
        voided_by: staff?.id,
        voided_at: now,
      })
      .eq("id", voidItem.id)
      .neq("status", "voided");
    if (updateError) {
      toast.error(updateError.message);
      setVoiding(false);
      return;
    }
    const { error: auditError } = await supabase.from("voids").insert({
      order_item_id: voidItem.id,
      reason: voidReason.trim(),
      voided_by: staff?.id,
      amount: voidItem.qty * voidItem.unit_price,
      shift_id: selected.shiftId ?? null,
    });
    if (auditError) {
      toast.error(`${c.auditFailed}: ${auditError.message}`);
      setVoiding(false);
      return;
    }
    if (voidItem.status !== "pending") {
      const line = {
        name_th: voidItem.name_th,
        name_en: voidItem.name_en,
        name_my: voidItem.name_my,
        qty: voidItem.qty,
        notes: `VOID: ${voidReason.trim()}`,
      };
      const payload: CounterPrintPayload = {
        kind: "order_ticket",
        ticket_type: "void",
        table: selected.code,
        source: "pos",
        order_type: "void",
        sent_at: now,
        lines: [line],
        language: "my",
        department: "VOID / CANCEL",
        station: "VOID / CANCEL",
        footer: "kitchen",
        alert_beep: true,
      };
      try {
        await printKitchenJobs([{ printer: "kitchen", payload }]);
        await printCounterJobs([{ ...payload, footer: "counter" }]);
      } catch (error) {
        toast.error(
          `${c.printFailed}: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    }
    toast.success(c.voided);
    setVoidItem(null);
    setRevealedItem(null);
    setVoiding(false);
    await load();
  };

  return (
    <div className="mx-auto max-w-xl p-4 pb-24">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">{c.title}</h1>
          <p className="text-sm text-muted-foreground">{c.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <Button variant="outline" size="icon" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-5 w-5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>
      <div className="mb-4 grid grid-cols-2 rounded-2xl bg-muted p-1.5">
        <button
          className={`rounded-xl px-3 py-3 font-bold ${filter === "available" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          onClick={() => setFilter("available")}
        >
          {c.available}{" "}
          <Badge variant="secondary" className="ml-1">
            {counts.available}
          </Badge>
        </button>
        <button
          className={`rounded-xl px-3 py-3 font-bold ${filter === "serving" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          onClick={() => setFilter("serving")}
        >
          {c.serving}{" "}
          <Badge variant="secondary" className="ml-1">
            {counts.serving}
          </Badge>
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {visibleTables.map((table) => {
          const available = table.status === "available";
          return (
            <button
              key={table.id}
              onClick={() => (available ? requestOpenTable(table) : setSelectedId(table.id))}
              className={`min-h-44 rounded-3xl border-2 p-4 text-left shadow-sm transition active:scale-[.98] ${table.status === "bill_requested" ? "border-orange-400 bg-orange-50" : available ? "bg-card" : "border-slate-300 bg-slate-100"}`}
            >
              <div className="flex items-start justify-between">
                <span className="text-4xl font-black">{tableLabel(table.code)}</span>
                {!available && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Users className="h-5 w-5" />
                    {table.guests}
                  </span>
                )}
              </div>
              {available ? (
                <div className="mt-8 flex justify-center">
                  <span className="rounded-full bg-muted p-3 text-primary">
                    <Plus className="h-8 w-8" />
                  </span>
                </div>
              ) : (
                <>
                  {table.status === "bill_requested" && (
                    <Badge className="mt-3 bg-orange-500">{c.billRequested}</Badge>
                  )}
                  <div className="mt-5 text-sm text-muted-foreground">{c.currentTotal}</div>
                  <div className="text-right text-2xl font-black">฿{table.total.toFixed(0)}</div>
                </>
              )}
            </button>
          );
        })}
      </div>
      {!loading && visibleTables.length === 0 && (
        <div className="py-20 text-center text-muted-foreground">{c.empty}</div>
      )}

      <Dialog
        open={!!openingTable}
        onOpenChange={(open) => {
          if (!open && !opening) setOpeningTable(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-2xl">
              {c.table} {openingTable ? tableLabel(openingTable.code) : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <div className="mb-4 text-lg font-semibold">{c.guests}</div>
            <div className="flex items-center justify-center gap-6">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-16 w-16 text-3xl"
                onClick={() => setGuestCount((count) => Math.max(1, count - 1))}
                disabled={opening || guestCount <= 1}
              >
                −
              </Button>
              <span className="w-14 text-center text-4xl font-black">{guestCount}</span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-16 w-16 text-3xl"
                onClick={() => setGuestCount((count) => Math.min(30, count + 1))}
                disabled={opening || guestCount >= 30}
              >
                +
              </Button>
            </div>
          </div>
          <Button
            className="h-14 text-lg"
            onClick={() => void confirmOpenTable()}
            disabled={opening}
          >
            {opening ? c.opening : c.openTable}
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
            setRevealedItem(null);
          }
        }}
      >
        <DialogContent className="max-h-[94dvh] overflow-y-auto p-4 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl">
              {c.table} {selected ? tableLabel(selected.code) : ""}
            </DialogTitle>
          </DialogHeader>
          {selected?.points ? (
            <div className="rounded-xl border border-green-300 bg-green-50 p-3 text-sm text-green-800">
              <b>
                {selected.memberName || c.member} · {selected.points.toLocaleString()} {c.points}
              </b>
              <div className="flex justify-between">
                <span>{c.rewardDiscount}</span>
                <span>−฿{selected.discount.toFixed(0)}</span>
              </div>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">{c.swipe}</p>
          <div className="max-h-[48dvh] space-y-2 overflow-y-auto overscroll-contain pr-1">
            {selected?.items.map((item) => (
              <div key={item.id} className="relative overflow-hidden rounded-xl bg-red-600">
                <button
                  className="absolute inset-y-0 right-0 flex w-24 flex-col items-center justify-center text-sm font-bold text-white"
                  onClick={() => requestVoid(item)}
                >
                  <Trash2 className="mb-1 h-5 w-5" />
                  {c.void}
                </button>
                <div
                  className={`relative rounded-xl border bg-background p-3 transition-transform ${revealedItem === item.id ? "-translate-x-24" : "translate-x-0"}`}
                  onTouchStart={(event) => {
                    touchStart.current = event.touches[0].clientX;
                  }}
                  onTouchEnd={(event) => {
                    const delta = event.changedTouches[0].clientX - touchStart.current;
                    if (delta < -45) setRevealedItem(item.id);
                    if (delta > 35) setRevealedItem(null);
                  }}
                >
                  <div className="flex justify-between gap-3">
                    <div>
                      <span className="mr-2 font-bold text-primary">{item.qty}×</span>
                      <span className="font-semibold">
                        {lang === "th"
                          ? item.name_th || item.name_en
                          : item.name_en || item.name_th}
                      </span>
                    </div>
                    <span className="font-semibold">
                      ฿{(item.qty * item.unit_price).toFixed(0)}
                    </span>
                  </div>
                  {item.notes && (
                    <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                      {item.notes}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-1 border-t pt-3">
            {selected && selected.discount > 0 && (
              <div className="flex justify-between text-green-700">
                <span>Points discount</span>
                <span>−฿{selected.discount.toFixed(0)}</span>
              </div>
            )}
            <div className="flex justify-between text-xl font-black">
              <span>{c.total}</span>
              <span>฿{selected?.total.toFixed(0)}</span>
            </div>
          </div>
          {selected && (
            <Button onClick={() => openOrder(selected)}>
              <ShoppingCart className="mr-2 h-4 w-4" />
              {c.addOrder}
            </Button>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!voidItem}
        onOpenChange={(open) => {
          if (!open && !voiding) setVoidItem(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {c.voidTitle}:{" "}
              {lang === "th"
                ? voidItem?.name_th || voidItem?.name_en
                : voidItem?.name_en || voidItem?.name_th}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{c.voidHelp}</p>
          <div className="grid gap-2">
            {VOID_REASON_KEYS.map((reason) => (
              <Button
                key={reason}
                type="button"
                variant={voidPreset === reason ? "default" : "outline"}
                onClick={() => {
                  setVoidPreset(reason);
                  setVoidReason(reason === "other" ? "" : c[reason]);
                }}
              >
                {c[reason]}
              </Button>
            ))}
          </div>
          {voidPreset === "other" && (
            <Input
              autoFocus
              placeholder={c.enterReason}
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
            />
          )}
          <Button
            variant="destructive"
            onClick={() => void confirmVoid()}
            disabled={voiding || !voidReason.trim()}
          >
            {voiding ? c.voiding : c.confirmVoid}
          </Button>
        </DialogContent>
      </Dialog>
      <ManagerPinDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        onApproved={() => void executeVoid()}
      />
    </div>
  );
}
