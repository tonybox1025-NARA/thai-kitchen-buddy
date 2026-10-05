import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const api = read("src/routes/api/public/checkout.$tableCode.ts");
const menu = read("src/routes/menu.$tableCode.tsx");
const payment = read("src/routes/_app/payment.$billId.tsx");
const crew = read("src/routes/_app/crew.tsx");
const migration = read("supabase/migrations/20261005170000_sunmi_only_loyalty_checkout.sql");

const failures = [];
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${needle}`);
};
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${needle}`);
};

requireText(api, 'z.literal("request_bill")', "public checkout API");
requireText(api, "available only at the SUNMI POS", "public checkout API");
for (const needle of ["reserve_customer_bill_loyalty", "create_or_get_member", "link_member_phone", "register_member"]) {
  forbidText(api, needle, "public checkout API");
}

requireText(menu, "crewMode && orderHistory.items.length > 0", "QR menu");
for (const needle of ["walletToken", "reserveReward", "linkMemberPhone", "registerMember", "signupOpen"]) {
  forbidText(menu, needle, "QR menu");
}

requireText(payment, 'import { isNativeApp } from "@/lib/print/native-printer"', "payment route");
requireText(payment, "if (isNativeApp()) return <PaymentPage />", "payment route");
requireText(payment, 'rpc("record_bill_payment"', "payment route");
requireText(payment, 'rpc("finalize_bill_payment"', "payment route");
requireText(payment, "p_redeem_points: finalizeMemberId ? pointsRedeemed : 0", "payment route");

for (const needle of ["record_bill_payment", "finalize_bill_payment", "process_bill_loyalty", "reserve_customer_bill_loyalty", '.from("payments")']) {
  forbidText(crew, needle, "Crew route");
}

for (const role of ["PUBLIC", "anon", "authenticated"]) {
  requireText(migration, role, "SUNMI-only migration");
}
requireText(migration, "REVOKE ALL ON FUNCTION public.reserve_customer_bill_loyalty", "SUNMI-only migration");
requireText(migration, "TO service_role", "SUNMI-only migration");

if (failures.length) {
  console.error("Terminal-only loyalty regression check failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("Terminal-only loyalty regression check passed.");

