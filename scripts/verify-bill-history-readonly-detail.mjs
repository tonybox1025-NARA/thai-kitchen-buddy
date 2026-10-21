import fs from "node:fs";

const reports = fs.readFileSync("src/routes/_app/reports.tsx", "utf8");
const detail = fs.readFileSync("src/routes/_app/bill.$billId.tsx", "utf8");
const payment = fs.readFileSync("src/routes/_app/payment.$billId.tsx", "utf8");

const checks = [
  [reports.includes('to="/bill/$billId"'), "Bill History opens the read-only Bill route"],
  [
    !reports.includes('to="/payment/$billId" params={{ billId: b.id }}'),
    "Bill History no longer opens checkout",
  ],
  [detail.includes('createFileRoute("/_app/bill/$billId")'), "dedicated Bill detail route"],
  [detail.includes('.from("order_items")'), "Bill detail loads order items"],
  [detail.includes('.from("payments")'), "Bill detail loads payment methods"],
  [detail.includes('.from("refunds")'), "Bill detail loads refund history"],
  [detail.includes("bkkDateTime("), "Bill detail uses Bangkok time"],
  [
    !detail.includes(".insert(") &&
      !detail.includes(".update(") &&
      !detail.includes(".upsert(") &&
      !detail.includes(".delete("),
    "Bill detail is read-only",
  ],
  [
    payment.includes('createFileRoute("/_app/payment/$billId")'),
    "SUNMI checkout route remains unchanged",
  ],
];

const missing = checks.filter(([ok]) => !ok).map(([, label]) => label);
if (missing.length) {
  console.error(`Bill History detail regression guard failed: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("Bill History read-only detail regression guard passed.");
