# Shared AI Change Log

This append-only log records material completed work by Codex or Claude Code. It complements Git history; it does not replace commits, pull requests, tests, deployment records, or Supabase audit evidence.

Add new entries at the top using this template:

```markdown
## YYYY-MM-DD — Short title
- Agent: Codex | Claude Code
- Scope: files/workflows affected
- Decision: what changed and why
- Verification: commands and results
- Git: branch and commit
- Delivery: pushed/merged, Lovable published or not, device updated or not, live verified or not
- Follow-up: none, or exact remaining work
```

## 2026-10-06 — Add permanent receipt numbers and receipt retrieval

- Agent: Codex
- Scope: paid Bills, counter receipts, Bill History search, reprint, and email handoff
- Decision: assign one immutable `LM-########` number in PostgreSQL when a real Bill becomes paid; preserve the existing durable print path; allow all-history lookup by receipt number and prepare a complete receipt email in the device mail app
- Verification: dedicated receipt workflow guard, full regression suite, production web build, and Android build
- Git: `codex/receipt-number-invoice`; see the commits containing this entry
- Delivery: pending PR, production migration, Lovable publish, Android release, and live verification
- Follow-up: Thai Full Tax Invoice remains a separate feature because it requires customer legal name/address/Tax ID and the restaurant's statutory invoice rules

## 2026-10-05 — Keep loyalty and payment on SUNMI only

- Agent: Codex
- Scope: customer QR menu, Crew bill requests, SUNMI checkout, legacy customer-loyalty RPC permissions, and Android release
- Decision: customer phones can order only; Crew can manage orders and request a bill; member lookup/signup, reward selection and payment render only in the native SUNMI app; point redemption and earning remain finalized atomically after successful payment
- Verification: dedicated terminal-only loyalty guard, full regression suite, web build, and Android build
- Git: `codex/loyalty-terminal-safety`; see the commits containing this entry
- Delivery: PR #60 merged, production RPC permissions restricted, Lovable production published and customer QR/API verified live; Android v1.1.82 released
- Follow-up: install v1.1.82 on SUNMI and verify native member lookup, point selection, and checkout on the device

## 2026-10-05 — Complete fully collected loyalty Bills safely

- Agent: Codex
- Scope: POS payment completion, customer points-member linkage, and database invariant
- Decision: complete checkout from the actual remaining balance, show the collected amount instead of zero, preserve a customer reservation when reconnecting its original member, and reject future points redemptions without a member link
- Verification: reproduced Table T10 as subtotal ฿288, points discount ฿100, QR paid ฿188, remaining ฿0 with Bill still open; dedicated regression guard and full production build passed
- Git: `codex/fix-paid-checkout-completion`; see the commits containing this entry
- Delivery: PR #58 merged, Lovable production published, database trigger installed, affected T10 member link repaired; Android v1.1.81 prepares the same fix for SUNMI
- Follow-up: complete the repaired T10 checkout and install v1.1.81 on SUNMI

## 2026-10-05 — Unify member and loyalty discounts in POS reporting

- Agent: Codex
- Scope: Z close/reprint, dashboard totals, discount and gross detail, and Manager App daily-summary export
- Decision: use one shared MB Discount calculation for both manual member discounts and loyalty-point redemption baht values; historical Z reprints rebuild this classification from authoritative closed bills
- Verification: member-discount regression guard, full regression suite, and production build passed
- Git: `codex/fix-z-member-discount`, PR #56; see the commits containing this entry
- Delivery: PR #56 merged and Lovable production published; Android v1.1.80 prepares the same fix for SUNMI
- Follow-up: install v1.1.80 on SUNMI and verify the 2026-10-04 Z reprint shows MB Discount ฿700

## 2026-10-04 — Shared Codex/Claude safety protocol installed

- Agent: Codex
- Scope: repository instructions, shared coordination protocol, and build-time instruction guard
- Decision: make Git history and this protocol the shared source of truth for Tony, the manager, Codex, and Claude Code
- Verification: `npm run guard:ai-protocol` and production build
- Git: see the commit that introduced this entry
- Delivery: repository workflow only; no POS behavior or production data changed
- Follow-up: none
