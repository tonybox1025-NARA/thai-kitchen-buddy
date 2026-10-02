import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Status = Record<string, number | string | null>;
type CloseReview = {
  id: string;
  business_day: string;
  kind: string;
  expected_amount: number | null;
  recorded_amount: number | null;
};
type ReviewSummary = { pending_count: number; items: CloseReview[] };

const reviewLabel: Record<string, string> = {
  paid_state_not_finalized: "Payment saved; Bill state recovered",
  payment_record_mismatch: "Checkout record needs tender review",
  order_not_finalized: "Order state recovered at closing",
  table_state_not_released: "Table state recovered at closing",
  loyalty_state_mismatch: "Loyalty record needs review",
};

/**
 * Owner-only system integrity, read from the authoritative database check.
 * Only items that need an accounting decision count as "attention";
 * print backlog and table drift recover automatically.
 */
export function IntegrityStatus() {
  const { staff } = useAuth() as any;
  const isOwner = staff?.role === "admin" || staff?.role === "manager";
  const [s, setS] = useState<Status | null>(null);
  const [review, setReview] = useState<ReviewSummary>({ pending_count: 0, items: [] });

  useEffect(() => {
    if (!isOwner) return;
    let alive = true;
    const load = async () => {
      const [{ data }, { data: reviewData }] = await Promise.all([
        (supabase as any).rpc("get_integrity_status"),
        (supabase as any).rpc("get_shift_close_review_summary"),
      ]);
      if (alive && data) setS(data as Status);
      if (alive && reviewData) setReview(reviewData as ReviewSummary);
    };
    void load();
    const id = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [isOwner]);

  const markReviewed = async (id: string) => {
    const { data, error } = await (supabase as any).rpc("mark_shift_close_reviewed", {
      p_review_id: id,
      p_resolved_by: staff?.id ?? null,
      p_resolution: "Manager confirmed checkout completed",
      p_note: null,
    });
    if (error || !data) {
      toast.error(error?.message ?? "Could not update manager review");
      return;
    }
    setReview((current) => ({
      pending_count: Math.max(0, current.pending_count - 1),
      items: current.items.filter((item) => item.id !== id),
    }));
    toast.success("Manager review completed");
  };

  if (!isOwner || !s) return null;
  const n = (k: string) => Number(s[k] ?? 0);
  const attention = [
    n("open_shifts") > 1 && `${n("open_shifts")} open shifts`,
    n("duplicate_open_orders_per_table") > 0 && `${n("duplicate_open_orders_per_table")} tables with duplicate orders`,
    n("duplicate_bills_per_order") > 0 && `${n("duplicate_bills_per_order")} orders with duplicate bills`,
    n("orphan_open_bills_with_money") > 0 && `${n("orphan_open_bills_with_money")} Bill records not finalized after payment`,
  ].filter(Boolean) as string[];
  const info = [
    `Inert open bills: ${n("orphan_open_bills_inert")}`,
    `Tickets waiting: ${n("print_pending")}`,
    `Table drift: ${n("table_projection_mismatches")}`,
  ];
  const ok = attention.length === 0;
  return <div className="space-y-2">
    <div className="rounded-lg border bg-card px-3 py-2 text-xs flex flex-wrap items-center gap-x-3 gap-y-1">
      {ok ? <ShieldCheck className="h-4 w-4 text-primary" /> : <ShieldAlert className="h-4 w-4 text-destructive" />}
      <span className="font-medium">{ok ? "System integrity OK" : attention.join(" · ")}</span>
      <span className="text-muted-foreground">{info.join(" · ")}</span>
    </div>
    {review.pending_count > 0 && <details className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-700 dark:bg-amber-950/30">
      <summary className="cursor-pointer font-semibold text-amber-900 dark:text-amber-200">
        Manager review: {review.pending_count} closing record{review.pending_count === 1 ? "" : "s"}
      </summary>
      <div className="mt-2 space-y-2">
        {review.items.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background/80 p-2">
          <div>
            <div className="font-medium">{item.business_day} · {reviewLabel[item.kind] ?? item.kind}</div>
            {item.expected_amount != null && <div className="text-xs text-muted-foreground">
              Bill ฿{Number(item.expected_amount).toFixed(2)} · recorded tender ฿{Number(item.recorded_amount ?? 0).toFixed(2)}
            </div>}
          </div>
          <Button size="sm" variant="outline" onClick={() => void markReviewed(item.id)}>
            Confirm checkout completed
          </Button>
        </div>)}
      </div>
    </details>}
  </div>;
}
