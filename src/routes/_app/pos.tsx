import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bell, Users, X } from "lucide-react";
import { toast } from "sonner";
import { playAlertBeep } from "@/lib/audio-alert";

export const Route = createFileRoute("/_app/pos")({ component: PosPage });

type RTable = {
  id: string; code: string; capacity: number;
  status: "available" | "occupied" | "bill_requested";
  guests: number; pos_x: number; pos_y: number; has_qr_alert: boolean;
};

function PosPage() {
  const { t } = useI18n();
  const { staff } = useAuth();
  const nav = useNavigate();
  const [tables, setTables] = useState<RTable[]>([]);
  const [openTable, setOpenTable] = useState<RTable | null>(null);
  const [guests, setGuests] = useState(2);
  const [banner, setBanner] = useState<{ tableCode: string; key: number } | null>(null);

  const load = async () => {
    const { data } = await supabase.from("restaurant_tables").select("*").order("code");
    if (data) setTables(data as RTable[]);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("tables-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_tables" }, () => load())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders", filter: "source=eq.qr" }, async (payload) => {
        toast.success(t("qr_alert"));
        playAlertBeep();
        const tableId = (payload.new as { table_id?: string } | null)?.table_id;
        if (tableId) {
          await supabase.from("restaurant_tables").update({ has_qr_alert: true }).eq("id", tableId);
          // Look up the table code for the banner
          const { data: tbl } = await supabase.from("restaurant_tables").select("code").eq("id", tableId).maybeSingle();
          setBanner({ tableCode: tbl?.code ?? "?", key: Date.now() });
        }
      })
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
      setGuests(2);
    } else {
      // find open order for this table
      const { data: order } = await supabase
        .from("orders").select("id").eq("table_id", tbl.id).eq("status", "open").maybeSingle();
      if (order) {
        if (tbl.has_qr_alert) await supabase.from("restaurant_tables").update({ has_qr_alert: false }).eq("id", tbl.id);
        nav({ to: "/order/$orderId", params: { orderId: order.id } });
      } else {
        toast.error("No open order found");
      }
    }
  };

  const startTable = async () => {
    if (!openTable || !staff) return;
    // Open shift if needed
    let { data: shift } = await supabase.from("shifts").select("id").eq("status", "open").maybeSingle();
    if (!shift) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: newShift } = await supabase.from("shifts").insert({ business_day: today, opened_by: staff.id, opening_float: 0 }).select("id").single();
      shift = newShift;
    }
    const { data: order, error } = await supabase.from("orders").insert({
      table_id: openTable.id, guests, opened_by: staff.id, shift_id: shift?.id, source: "pos",
    }).select("id").single();
    if (error || !order) { toast.error(error?.message || "Failed"); return; }
    await supabase.from("restaurant_tables").update({ status: "occupied", guests }).eq("id", openTable.id);
    setOpenTable(null);
    nav({ to: "/order/$orderId", params: { orderId: order.id } });
  };

  const colorFor = (s: RTable["status"]) =>
    s === "available" ? "bg-table-available text-white"
    : s === "bill_requested" ? "bg-table-bill text-white"
    : "bg-table-occupied text-white";

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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("nav_pos")}</h1>
        <div className="flex items-center gap-3 text-sm">
          <Legend color="bg-table-available" label={t("available")} />
          <Legend color="bg-table-occupied" label={t("occupied")} />
          <Legend color="bg-table-bill" label={t("bill_requested")} />
        </div>
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2">
        {tables.map((tbl) => (
          <button
            key={tbl.id}
            onClick={() => onTableClick(tbl)}
            className={`relative aspect-square rounded-xl shadow-sm hover:shadow-md transition-all ${tbl.has_qr_alert ? "alert-flash" : colorFor(tbl.status)} flex flex-col items-center justify-center gap-0.5 p-1`}
          >
            {tbl.has_qr_alert && (
              <>
                <span className="absolute top-2 right-2">
                  <Bell className="h-5 w-5 animate-pulse" />
                </span>
                <span className="absolute -top-2 -left-2 inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-white text-destructive text-xs font-bold shadow">
                  NEW
                </span>
              </>
            )}
            <div className="text-3xl font-bold">{tbl.code}</div>
            <div className="text-xs opacity-90">{tbl.capacity} seats</div>
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
            <Input type="number" min={1} max={20} value={guests} onChange={(e) => setGuests(Math.max(1, Number(e.target.value)))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenTable(null)}>{t("cancel")}</Button>
            <Button onClick={startTable}>{t("start")}</Button>
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
