import { readFileSync } from "node:fs";

const aggregate = readFileSync(
  new URL("../src/lib/print/aggregate-receipt-items.ts", import.meta.url),
  "utf8",
);
const raster = readFileSync(new URL("../src/lib/print/raster.ts", import.meta.url), "utf8");
const payment = readFileSync(
  new URL("../src/routes/_app/payment.$billId.tsx", import.meta.url),
  "utf8",
);

if (!aggregate.includes("cleanCustomerItemName") || !aggregate.includes('"name_th"')) {
  throw new Error("Customer receipt name cleaning guard is missing");
}
if (!raster.includes("receiptItem(qty: number") || !raster.includes("d.receiptItem(qty, name")) {
  throw new Error("Customer receipt hanging-indent layout guard is missing");
}
if (
  !payment.includes("const loadReceiptPayments") ||
  !payment.includes("const receiptPayments = await loadReceiptPayments(latestPayment)") ||
  !payment.includes("payments: receiptPayments")
) {
  throw new Error("Authoritative receipt payment-method guard is missing");
}

console.log("Customer receipt layout regression guard passed");
