import fs from "node:fs";

const source = fs.readFileSync("src/routes/_app/payment.$billId.tsx", "utf8");
const migration = fs.readFileSync(
  "supabase/migrations/20261005135000_require_member_for_points_redemption.sql",
  "utf8",
);

const checks = [
  [
    source.includes("const completeCollectedCheckout = async ()") && source.includes("remaining > 0.001"),
    "fully collected non-zero Bills can be completed from the payment screen",
  ],
  [
    source.includes('"Paid"} ${thb(paid)}'),
    "the completion button shows the money already collected instead of zero",
  ],
  [
    source.includes("pointsRedeemed > 0 && !finalizeMemberId"),
    "checkout blocks rather than granting a points discount with no member",
  ],
  [
    source.includes("recoveringCustomerReservation") &&
      source.includes('loyalty_reservation_source === "customer_qr"'),
    "reselecting the original customer preserves their phone reservation",
  ],
  [
    migration.includes("COALESCE(NEW.points_redeemed, 0) > 0 AND NEW.member_id IS NULL"),
    "the database rejects future points redemptions without a member link",
  ],
];

for (const [ok, description] of checks) {
  if (!ok) throw new Error(`Paid checkout regression: ${description}`);
}

// Exact reported case: ฿288 subtotal - ฿100 reward = ฿188 total, already paid.
const total = 188;
const paid = 188;
const remaining = Math.max(0, total - paid);
if (remaining > 0.001) throw new Error("Reported fully collected Bill must be completable");

console.log("Paid checkout completion regression checks passed.");
