import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { thb } from "@/lib/format";

export const Route = createFileRoute("/_app/dashboard")({ component: Dashboard });

type Range = "today" | "yesterday" | "week" | "month";

function rangeBounds(r: Range): [Date, Date] {
  const now = new Date();
  const start = new Date(now); const end = new Date(now);
  if (r === "today") { start.setHours(0,0,0,0); end.setHours(23,59,59,999); }
  else if (r === "yesterday") { start.setDate(start.getDate()-1); start.setHours(0,0,0,0); end.setDate(end.getDate()-1); end.setHours(23,59,59,999); }
  else if (r === "week") { const d = start.getDay() || 7; start.setDate(start.getDate()-(d-1)); start.setHours(0,0,0,0); end.setHours(23,59,59,999); }
  else { start.setDate(1); start.setHours(0,0,0,0); end.setHours(23,59,59,999); }
  return [start, end];
}

function Dashboard() {
  const [range, setRange] = useState<Range>("today");
  const [bills, setBills] = useState<{ id: string; total: number; subtotal: number; discount_amount: number; member_discount_amount: number }[]>([]);
  const [payments, setPayments] = useState<{ method: string; amount: number; bill_id: string }[]>([]);

  useEffect(() => {
    (async () => {
      const [from, to] = rangeBounds(range);
      const { data: b } = await supabase.from("bills").select("id,total,subtotal,discount_amount,member_discount_amount,paid_at").eq("status", "paid").gte("paid_at", from.toISOString()).lte("paid_at", to.toISOString());
      setBills((b ?? []) as typeof bills);
      const ids = (b ?? []).map((x) => x.id);
      if (ids.length) {
        const { data: p } = await supabase.from("payments").select("method,amount,bill_id").in("bill_id", ids);
        setPayments((p ?? []) as typeof payments);
      } else setPayments([]);
    })();
  }, [range]);

  const stats = useMemo(() => {
    const gross = bills.reduce((s, b) => s + Number(b.subtotal), 0);
    const net = bills.reduce((s, b) => s + Number(b.total), 0);
    const discounts = bills.reduce((s, b) => s + Number(b.discount_amount) + Number(b.member_discount_amount), 0);
    const byMethod: Record<string, number> = { cash: 0, qr: 0, card: 0 };
    payments.forEach((p) => { byMethod[p.method] = (byMethod[p.method] ?? 0) + Number(p.amount); });
    return { gross, net, discounts, byMethod, count: bills.length };
  }, [bills, payments]);

  return (
    <div className="p-6 space-y-6" lang="en">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex gap-2">
          {(["today","yesterday","week","month"] as Range[]).map((r) => (
            <Button key={r} variant={range === r ? "default" : "outline"} size="sm" onClick={() => setRange(r)}>
              {r === "today" ? "Today" : r === "yesterday" ? "Yesterday" : r === "week" ? "This week" : "This month"}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat title="Gross sales" value={thb(stats.gross)} />
        <Stat title="Net sales" value={thb(stats.net)} />
        <Stat title="Discounts" value={thb(stats.discounts)} />
        <Stat title="Bills" value={String(stats.count)} />
      </div>
      <Card>
        <CardHeader><CardTitle>By payment method</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-3 gap-4">
          <Stat title="Cash" value={thb(stats.byMethod.cash)} />
          <Stat title="QR Transfer" value={thb(stats.byMethod.qr)} />
          <Stat title="Credit card" value={thb(stats.byMethod.card)} />
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}
