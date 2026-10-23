import fs from "node:fs";

const reports = fs.readFileSync("src/routes/_app/reports.tsx", "utf8");

const required = [
  "couponCount: number;",
  "couponCount: Number(raw.couponCount ?? 0)",
  'const couponCount = billDiscRows.filter((d) => d.free_item_name === "__coupon__").length;',
  '"couponCount",',
  "Coupon (${r.couponCount} uses)",
];

for (const marker of required) {
  if (!reports.includes(marker)) {
    throw new Error(`Missing coupon reporting guard: ${marker}`);
  }
}

console.log("Coupon count and amount reporting guard passed");
