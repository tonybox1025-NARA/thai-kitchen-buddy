/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, ReceiptText, ShoppingCart, Users } from "lucide-react";
import { tableLabel } from "@/lib/table";

export const Route = createFileRoute("/_app/crew")({ component: CrewPage });

type CrewTable = {
  id: string;
  code: string;
  status: "available" | "occupied" | "bill_requested";
  guests: number;
  orderId?: string;
  total: number;
  points: number;
  discount: number;
  memberName?: string | null;
};

function CrewPage() {
  const nav = useNavigate();
  const [tables, setTables] = useState<CrewTable[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data: tableRows } = await supabase
      .from("restaurant_tables")
      .select("id,code,status,guests")
      .order("code");
    const busy = (tableRows ?? []).filter((table) => table.status !== "available");
    const next: CrewTable[] = [];
    for (const table of busy) {
      const { data: orderRows } = await supabase
        .from("orders")
        .select("id")
        .eq("table_id", table.id)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1);
      const order = orderRows?.[0];
      if (!order) continue;
      const [{ data: items }, { data: bill }] = await Promise.all([
        supabase
          .from("order_items")
          .select("qty,unit_price,status")
          .eq("order_id", order.id)
          .neq("status", "voided"),
        (supabase as any)
          .from("bills")
          .select("member_id,points_redeemed,loyalty_discount_amount,members(full_name,nickname)")
          .eq("order_id", order.id)
          .maybeSingle(),
      ]);
      const subtotal = (items ?? []).reduce(
        (sum, item) => sum + Number(item.qty) * Number(item.unit_price),
        0,
      );
      next.push({
        ...table,
        status: table.status as CrewTable["status"],
        orderId: order.id,
        total: Math.max(0, subtotal - Number(bill?.loyalty_discount_amount ?? 0)),
        points: Number(bill?.points_redeemed ?? 0),
        discount: Number(bill?.loyalty_discount_amount ?? 0),
        memberName: bill?.members?.nickname || bill?.members?.full_name || null,
      });
    }
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

  return (
    <div className="mx-auto max-w-xl p-4 pb-24">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black">Crew</h1>
          <p className="text-sm text-muted-foreground">Tables · assisted ordering · bill status</p>
        </div>
        <Button variant="outline" size="icon" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tables.map((table) => (
          <div
            key={table.id}
            className={`rounded-2xl border-2 p-4 shadow-sm ${table.status === "bill_requested" ? "border-orange-400 bg-orange-50" : "bg-card"}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="text-3xl font-black">{tableLabel(table.code)}</div>
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                {table.guests}
              </div>
            </div>
            {table.status === "bill_requested" && (
              <Badge className="mt-2 bg-orange-500">Bill requested</Badge>
            )}
            {table.points > 0 && (
              <div className="mt-3 rounded-xl border border-green-300 bg-green-50 p-3 text-sm">
                <div className="font-semibold text-green-800">
                  {table.memberName || "Member"} · {table.points.toLocaleString()} points
                </div>
                <div className="flex justify-between text-green-700">
                  <span>Reward discount</span>
                  <span>−฿{table.discount.toFixed(0)}</span>
                </div>
              </div>
            )}
            <div className="mt-3 flex items-end justify-between">
              <span className="text-sm text-muted-foreground">Current total</span>
              <span className="text-2xl font-black">฿{table.total.toFixed(0)}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  window.location.href = `/menu/${encodeURIComponent(table.code)}?crew=1`;
                }}
              >
                <ShoppingCart className="mr-2 h-4 w-4" />
                Order
              </Button>
              <Button
                onClick={() =>
                  table.orderId &&
                  nav({ to: "/order/$orderId", params: { orderId: table.orderId } })
                }
              >
                <ReceiptText className="mr-2 h-4 w-4" />
                Details
              </Button>
            </div>
          </div>
        ))}
      </div>
      {!loading && tables.length === 0 && (
        <div className="py-20 text-center text-muted-foreground">No occupied tables</div>
      )}
    </div>
  );
}
