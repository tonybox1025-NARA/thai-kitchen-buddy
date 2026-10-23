import fs from "node:fs";

const source = fs.readFileSync("src/routes/_app/detail-gross.tsx", "utf8");

const required = [
  "const BILL_PAGE_SIZE = 500;",
  "async function fetchBillsForShifts",
  ".range(from, from + BILL_PAGE_SIZE - 1)",
  '.not("is_test", "is", true)',
  "if (!data || data.length < BILL_PAGE_SIZE) break;",
  "fetchBillsForShifts(shiftIds)",
  'rpc("staff_tab_shift_activity", { p_shift_ids: shiftIds })',
  'row.activity_type === "charge"',
  'fetchCouponDiscount(b.map((bill) => bill.id))',
  "bills.reduce((s, b) => s + Number(b.discount_amount), 0) - couponDiscount",
  '[t("coupon"), couponDiscount]',
];

for (const marker of required) {
  if (!source.includes(marker)) {
    throw new Error(`Missing dashboard sales pagination guard: ${marker}`);
  }
}

if (source.includes('.order("paid_at", { ascending: false }).limit(500)')) {
  throw new Error("Gross-sales detail still truncates monthly bills at 500 rows");
}

console.log("Dashboard gross-sales pagination guard passed");
