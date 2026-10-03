import { readFileSync } from "node:fs";

const aggregate = readFileSync(
  new URL("../src/lib/print/aggregate-receipt-items.ts", import.meta.url),
  "utf8",
);
const raster = readFileSync(new URL("../src/lib/print/raster.ts", import.meta.url), "utf8");

if (!aggregate.includes("cleanCustomerItemName") || !aggregate.includes('"name_th"')) {
  throw new Error("Customer receipt name cleaning guard is missing");
}
if (!raster.includes("receiptItem(qty: number") || !raster.includes("d.receiptItem(qty, name")) {
  throw new Error("Customer receipt hanging-indent layout guard is missing");
}

console.log("Customer receipt layout regression guard passed");
