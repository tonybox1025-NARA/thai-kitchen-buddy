import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type CloseReview = {
  id: string;
  business_day: string;
  kind: string;
  expected_amount: number | null;
  recorded_amount: number | null;
  bill_id: string | null;
  order_id: string | null;
};
type ReviewSummary = { pending_count: number; items: CloseReview[] };

const labels: Record<string, { th: string; en: string }> = {
  paid_state_not_finalized: { th: "บันทึกการชำระแล้ว แต่สถานะบิลได้รับการกู้คืนตอนปิดกะ", en: "Payment saved; bill state recovered at closing" },
  payment_record_mismatch: { th: "ยอดบิลและยอดชำระต้องตรวจสอบ", en: "Bill and recorded tender need review" },
  order_not_finalized: { th: "สถานะออเดอร์ได้รับการกู้คืนตอนปิดกะ", en: "Order state recovered at closing" },
  table_state_not_released: { th: "สถานะโต๊ะได้รับการกู้คืนตอนปิดกะ", en: "Table state recovered at closing" },
  loyalty_state_mismatch: { th: "ข้อมูลคะแนนสะสมต้องตรวจสอบ", en: "Loyalty record needs review" },
};

export function ShiftCloseReview() {
  const { staff } = useAuth() as any;
  const { lang } = useI18n();
  const isOwner = staff?.role === "admin" || staff?.role === "manager";
  const [review, setReview] = useState<ReviewSummary>({ pending_count: 0, items: [] });

  useEffect(() => {
    if (!isOwner) return;
    void (async () => {
      const { data } = await (supabase as any).rpc("get_shift_close_review_summary");
      if (data) setReview(data as ReviewSummary);
    })();
  }, [isOwner]);

  const markReviewed = async (id: string) => {
    const { data, error } = await (supabase as any).rpc("mark_shift_close_reviewed", {
      p_review_id: id,
      p_resolved_by: staff?.id ?? null,
      p_resolution: "Manager confirmed checkout completed",
      p_note: null,
    });
    if (error || !data) {
      toast.error(lang === "th" ? "บันทึกการตรวจสอบไม่สำเร็จ" : "Could not update manager review");
      return;
    }
    setReview((current) => ({
      pending_count: Math.max(0, current.pending_count - 1),
      items: current.items.filter((item) => item.id !== id),
    }));
    toast.success(lang === "th" ? "บันทึกการตรวจสอบแล้ว" : "Manager review completed");
  };

  if (!isOwner || review.pending_count === 0) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-700 dark:bg-amber-950/30">
      <div className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4" />
        {lang === "th" ? `รายการปิดกะที่ผู้จัดการต้องตรวจสอบ ${review.pending_count} รายการ` : `${review.pending_count} closing record(s) need manager review`}
      </div>
      <div className="mt-3 space-y-2">
        {review.items.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background/90 p-3">
            <div>
              <div className="font-medium">
                {lang === "th" ? "วันทำการ" : "Business day"} {item.business_day} · {labels[item.kind]?.[lang] ?? item.kind}
              </div>
              {item.expected_amount != null && (
                <div className="text-xs text-muted-foreground">
                  {lang === "th" ? "ยอดบิล" : "Bill"} ฿{Number(item.expected_amount).toFixed(2)} · {lang === "th" ? "ยอดชำระที่บันทึก" : "recorded tender"} ฿{Number(item.recorded_amount ?? 0).toFixed(2)}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {item.order_id && (
                <Button asChild size="sm" variant="outline">
                  <Link to="/order/$orderId" params={{ orderId: item.order_id }}>
                    {lang === "th" ? "ดูออเดอร์" : "View order"}<ChevronRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
              )}
              <Button size="sm" onClick={() => void markReviewed(item.id)}>
                {lang === "th" ? "ตรวจสอบแล้ว" : "Mark reviewed"}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
