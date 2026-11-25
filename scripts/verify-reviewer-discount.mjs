import fs from "node:fs";

const payment = fs.readFileSync("src/routes/_app/payment.$billId.tsx", "utf8");
const detail = fs.readFileSync("src/routes/_app/detail-discounts.tsx", "utf8");
const register = fs.readFileSync("src/routes/_app/register.tsx", "utf8");
const reports = fs.readFileSync("src/routes/_app/reports.tsx", "utf8");

const checks = [
  [payment.includes('value="reviewer"'), "SUNMI payment screen exposes the Reviewer discount"],
  [payment.includes('extras.free_item_name = "__reviewer__"'), "Reviewer is stored with its durable marker"],
  [payment.includes('extras.percent_value = 100'), "Reviewer records a 100% discount"],
  [payment.includes('"100% complimentary reviewer meal · no cash, QR, or card payment"'), "Reviewer explains that no tender is recorded"],
  [payment.includes('appliedDiscount.free_item_name !== "__reviewer__"'), "Reviewer is not rendered again as a generic percent discount"],
  [detail.includes('| "reviewer" |') && detail.includes('Social Media Reviewer · 100%'), "Discount detail identifies Reviewer separately"],
  [register.includes('free_item_name === "__reviewer__"') && register.includes("reviewerCount"), "Register reports Reviewer separately"],
  [reports.includes('free_item_name === "__reviewer__"') && reports.includes("reviewerCount"), "X/Z and historical reports retain Reviewer totals"],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length) {
  for (const [, message] of failed) console.error(`FAIL: ${message}`);
  process.exit(1);
}

for (const [, message] of checks) console.log(`PASS: ${message}`);
