import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/20261024220000_refresh_open_bill_after_order_item_change.sql",
  "utf8",
);

const checks = [
  [migration.includes("refresh_open_bill_totals_for_order"), "authoritative Bill refresh function"],
  [migration.includes("oi.status <> 'voided'"), "voided lines excluded from subtotal and item discounts"],
  [migration.includes("after insert or update of order_id, qty, unit_price, status or delete"), "all order-line amount changes trigger refresh"],
  [migration.includes("where order_id = p_order_id and status = 'open'"), "paid historical Bills remain immutable"],
  [migration.includes("service_fee_amount = v_service_fee"), "service fee recalculated"],
  [migration.includes("vat_amount = v_vat"), "VAT recalculated"],
  [migration.includes("rounding_adjustment = v_rounding_adjustment"), "rounding recalculated"],
];

for (const [ok, description] of checks) {
  if (!ok) throw new Error(`Void-before-payment regression: missing ${description}`);
}

console.log("Void-before-payment regression checks passed.");
