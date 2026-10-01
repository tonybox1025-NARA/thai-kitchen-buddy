import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

type Status = Record<string, number | string | null>;

/**
 * Owner-only system integrity, read from the authoritative database check.
 * Only items that need an accounting decision count as "attention";
 * print backlog and table drift recover automatically.
 */
export function IntegrityStatus() {
  const { staff } = useAuth() as any;
  const isOwner = staff?.role === "admin" || staff?.role === "manager";
  const [s, setS] = useState<Status | null>(null);

  useEffect(() => {
    if (!isOwner) return;
    let alive = true;
    const load = async () => {
      const { data } = await (supabase as any).rpc("get_integrity_status");
      if (alive && data) setS(data as Status);
    };
    void load();
    const id = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [isOwner]);

  if (!isOwner || !s) return null;
  const n = (k: string) => Number(s[k] ?? 0);
  const attention = [
    n("open_shifts") > 1 && `${n("open_shifts")} open shifts`,
    n("duplicate_open_orders_per_table") > 0 && `${n("duplicate_open_orders_per_table")} tables with duplicate orders`,
    n("duplicate_bills_per_order") > 0 && `${n("duplicate_bills_per_order")} orders with duplicate bills`,
    n("orphan_open_bills_with_money") > 0 && `${n("orphan_open_bills_with_money")} unpaid bills with payments on closed orders`,
  ].filter(Boolean) as string[];
  const info = [
    `Inert open bills: ${n("orphan_open_bills_inert")}`,
    `Tickets waiting: ${n("print_pending")}`,
    `Table drift: ${n("table_projection_mismatches")}`,
  ];
  const ok = attention.length === 0;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs flex flex-wrap items-center gap-x-3 gap-y-1">
      {ok ? <ShieldCheck className="h-4 w-4 text-primary" /> : <ShieldAlert className="h-4 w-4 text-destructive" />}
      <span className="font-medium">{ok ? "System integrity OK" : attention.join(" · ")}</span>
      <span className="text-muted-foreground">{info.join(" · ")}</span>
    </div>
  );
}
