import fs from "node:fs";

const dashboard = fs.readFileSync("src/components/IntegrityStatus.tsx", "utf8");
const review = fs.readFileSync("src/components/ShiftCloseReview.tsx", "utf8");
const reports = fs.readFileSync("src/routes/_app/reports.tsx", "utf8");
const migration = fs.readFileSync("supabase/migrations/20261003173000_operational_integrity_only.sql", "utf8");

const checks = [
  [!dashboard.includes("orphan_open_bills_with_money"), "Dashboard must not show close-time bill review warnings"],
  [!dashboard.includes("get_shift_close_review_summary"), "Dashboard must not load manager close reviews"],
  [dashboard.includes("get_operational_integrity_issues"), "Dashboard must load actionable operational issue details"],
  [dashboard.includes('to: "/order/$orderId"'), "Operational issue must link to its order"],
  [reports.includes("<ShiftCloseReview />"), "Z Report History must show manager close reviews"],
  [review.includes("get_shift_close_review_summary"), "Close review panel must load authoritative review records"],
  [migration.includes("o.source = 'staff_meal'") && migration.includes("staff_tab_charges"), "Normal staff credit must be excluded from false payment warnings"],
];

for (const [ok, message] of checks) {
  if (!ok) throw new Error(message);
}

console.log("Operational integrity UI regression checks passed");
