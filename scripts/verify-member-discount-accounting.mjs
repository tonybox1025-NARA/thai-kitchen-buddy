import { readFileSync } from "node:fs";
import { totalMemberDiscount } from "../src/lib/member-discount.ts";

const fixture = [
  { member_discount_amount: 0, loyalty_discount_amount: 600 },
  { member_discount_amount: 0, loyalty_discount_amount: 100 },
  { member_discount_amount: null, loyalty_discount_amount: null },
];

if (totalMemberDiscount(fixture) !== 700) {
  throw new Error("MB Discount must include all loyalty-point redemption baht values");
}

const sources = [
  "src/routes/_app/register.tsx",
  "src/routes/_app/reports.tsx",
  "src/routes/_app/dashboard.tsx",
  "src/routes/_app/detail-gross.tsx",
  "src/routes/_app/detail-discounts.tsx",
  "src/routes/api/public/daily-summary.$date.ts",
];

for (const path of sources) {
  const source = readFileSync(path, "utf8");
  if (!source.includes("totalMemberDiscount")) {
    throw new Error(`${path} must use the shared MB Discount calculation`);
  }
  if (!source.includes("loyalty_discount_amount")) {
    throw new Error(`${path} must load loyalty_discount_amount`);
  }
}

const reports = readFileSync("src/routes/_app/reports.tsx", "utf8");
if (!reports.includes("report.member = totalMemberDiscount(memberBills ?? [])")) {
  throw new Error("Historical Z reprints must repair the MB Discount classification from bills");
}

console.log("Member discount accounting regression guard passed");
