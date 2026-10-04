import { readFileSync } from "node:fs";

const settlement = readFileSync("src/lib/kbank-settlement.ts", "utf8");
const summary = readFileSync("src/routes/api/public/daily-summary.$date.ts", "utf8");

const required = [
  [
    settlement.includes("Number(row.tip_amount)"),
    "KBANK settlement must include QR tip_amount in bank receipts",
  ],
  [
    summary.includes('.select("amount,tip_amount,created_at")'),
    "previous-day QR settlement query must load tip_amount",
  ],
  [
    summary.includes('qr_prompt_amount: byMethod("qr")'),
    "daily PromptPay sales must remain amount-only",
  ],
];

for (const [ok, message] of required) {
  if (!ok) throw new Error(message);
}

console.log("KBANK settlement tip regression guard passed");
