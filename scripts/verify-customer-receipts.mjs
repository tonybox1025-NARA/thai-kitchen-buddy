import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/20261007120000_customer_receipt_documents.sql",
  "utf8",
);
const page = fs.readFileSync("src/routes/_app/receipts.tsx", "utf8");
const raster = fs.readFileSync("src/lib/print/raster.ts", "utf8");
const navigation = fs.readFileSync("src/routes/_app.tsx", "utf8");

const checks = [
  [
    migration.includes("CREATE TABLE IF NOT EXISTS public.receipt_documents"),
    "saved receipt-document records",
  ],
  [
    migration.includes("CHECK (document_kind = 'receipt')"),
    "database blocks tax-invoice document kinds",
  ],
  [migration.includes("seller_vat_registered = false"), "database blocks VAT receipt snapshots"],
  [migration.includes("business_tax_id = '0105568081262'"), "verified seller Tax ID seed"],
  [
    page.includes('.eq("receipt_number", receiptNumber)'),
    "exact all-history receipt-number search",
  ],
  [
    !page.includes('<div class="notice">') && !page.includes("non_vat_notice:"),
    "customer print omits the internal non-VAT notice",
  ],
  [
    page.includes("เลขที่ใบเสร็จรับเงิน / Receipt No."),
    "PDF uses the full receipt-number label",
  ],
  [page.includes("Print / Save PDF"), "print and PDF-save workflow"],
  [page.includes("formal-receipt:"), "durable counter reprint key"],
  [
    raster.includes("เลขที่ใบเสร็จรับเงิน ${p.invoice_no}") &&
      !raster.includes("if (p.non_vat_notice)"),
    "counter receipt number label and hidden internal notice",
  ],
  [
    raster.indexOf("if (p.customer_tax_id)") < raster.indexOf("if (p.customer_address)"),
    "customer Tax ID appears between customer name and address",
  ],
  [navigation.includes('{ to: "/receipts"'), "top-level receipt navigation"],
];

const missing = checks.filter(([ok]) => !ok).map(([, label]) => label);
if (missing.length) {
  console.error(`Customer receipt regression guard failed: ${missing.join(", ")}`);
  process.exit(1);
}
console.log("Customer receipt document regression guard passed.");
