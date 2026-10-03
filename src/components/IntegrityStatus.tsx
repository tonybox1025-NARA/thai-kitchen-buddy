import { useEffect, useState } from "react";
import { ShieldAlert, ChevronRight } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

type Status = Record<string, number | string | null>;
type OperationalIssue = {
  kind: "duplicate_open_orders" | "duplicate_bills";
  order_id: string | null;
  table_code: string | null;
  order_number: string | null;
  record_count: number;
};

/** Shows only problems that need action while the restaurant is operating. */
export function IntegrityStatus() {
  const { staff } = useAuth() as any;
  const { lang } = useI18n();
  const navigate = useNavigate();
  const isOwner = staff?.role === "admin" || staff?.role === "manager";
  const [status, setStatus] = useState<Status | null>(null);
  const [issues, setIssues] = useState<OperationalIssue[]>([]);

  useEffect(() => {
    if (!isOwner) return;
    let alive = true;
    const load = async () => {
      const [{ data }, { data: issueData }] = await Promise.all([
        (supabase as any).rpc("get_integrity_status"),
        (supabase as any).rpc("get_operational_integrity_issues"),
      ]);
      if (alive && data) setStatus(data as Status);
      if (alive) setIssues((issueData ?? []) as OperationalIssue[]);
    };
    void load();
    const id = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [isOwner]);

  if (!isOwner || !status) return null;
  const n = (key: string) => Number(status[key] ?? 0);
  const openShiftProblem = n("open_shifts") > 1;
  const hasOperationalProblem = openShiftProblem || issues.length > 0;

  // Healthy operation gets no banner. Normal staff credit, automatic recovery,
  // print retries and close-time review records do not interrupt trade.
  if (!hasOperationalProblem) return null;

  const issueCount = issues.length + (openShiftProblem ? 1 : 0);
  const title = lang === "th"
    ? `พบปัญหาที่ต้องแก้ระหว่างเปิดร้าน ${issueCount} รายการ`
    : `${issueCount} issue(s) need attention while open`;

  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
      <div className="flex items-center gap-2 font-semibold text-destructive">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <span>{title}</span>
      </div>
      <div className="mt-2 space-y-1">
        {openShiftProblem && (
          <div className="rounded-md bg-background/80 px-3 py-2">
            {lang === "th" ? `มีกะเปิดพร้อมกัน ${n("open_shifts")} กะ กรุณาตรวจสอบหน้าเครื่องบันทึกเงินสด` : `${n("open_shifts")} register shifts are open. Check Register.`}
          </div>
        )}
        {issues.map((issue, index) => {
          const label = issue.table_code
            ? (lang === "th" ? `โต๊ะ ${issue.table_code}` : `Table ${issue.table_code}`)
            : issue.order_number ?? (lang === "th" ? "ไม่ทราบออเดอร์" : "Unknown order");
          const message = issue.kind === "duplicate_open_orders"
            ? (lang === "th" ? `${label} มีออเดอร์เปิดซ้ำ ${issue.record_count} รายการ` : `${label} has ${issue.record_count} open orders`)
            : (lang === "th" ? `${label} มีบิลซ้ำ ${issue.record_count} ใบ` : `${label} has ${issue.record_count} duplicate bills`);
          return issue.order_id ? (
            <button
              key={`${issue.kind}-${issue.order_id}-${index}`}
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-md bg-background/80 px-3 py-2 text-left hover:bg-muted"
              onClick={() => navigate({ to: "/order/$orderId", params: { orderId: issue.order_id! } })}
            >
              <span>{message}</span>
              <ChevronRight className="h-4 w-4 shrink-0" />
            </button>
          ) : (
            <div key={`${issue.kind}-${index}`} className="rounded-md bg-background/80 px-3 py-2">{message}</div>
          );
        })}
      </div>
    </div>
  );
}
