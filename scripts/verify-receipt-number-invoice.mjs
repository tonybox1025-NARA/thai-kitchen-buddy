import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/20261006090000_receipt_numbers.sql", "utf8");
const payment = fs.readFileSync("src/routes/_app/payment.$billId.tsx", "utf8");
const reports = fs.readFileSync("src/routes/_app/reports.tsx", "utf8");

const checks = [
  [migration.includes("ADD COLUMN IF NOT EXISTS receipt_number"), "receipt number column"],
  [migration.includes("CREATE TABLE IF NOT EXISTS public.receipt_number_counters"), "atomic daily counter table"],
  [migration.includes("AT TIME ZONE 'Asia/Bangkok'"), "Bangkok receipt date"],
  [migration.includes("'LM'"), "receipt prefix without separators"],
  [migration.includes("lpad(v_daily_number::text, GREATEST(3"), "daily sequence padded from 001"],
  [migration.includes("assign_bill_receipt_number_trigger"), "paid-bill assignment trigger"],
  [migration.includes("bills_receipt_number_uidx"), "unique receipt number index"],
  [payment.includes("invoice_no: receiptNumber"), "printed receipt number"],
  [payment.includes("Email Receipt"), "paid receipt email action"],
  [reports.includes('.ilike("receipt_number"'), "all-history receipt search"],
  [reports.includes("b.receipt_number ??"), "receipt number shown in Bill History"],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length) {
  for (const [, label] of failed) console.error(`Missing: ${label}`);
  process.exit(1);
}
console.log("Receipt-number and invoice workflow guard passed.");
