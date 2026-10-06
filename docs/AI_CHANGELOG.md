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

## 2026-10-07 — Keep the Android update action visible

- Agent: Codex
- Scope: GitHub Android release asset, in-app update APK discovery, missing-package feedback, and Android release
- Decision: publish POS APKs as `LONMOH-POS-vX.Y.Z.apk`; also accept exactly one non-Print-Bridge APK so a harmless upload filename mismatch cannot hide the update button
- Verification: dedicated updater regression guard, full regression suite, production web build, Android build, GitHub release asset inspection, and SUNMI action availability to be confirmed after install
- Git: branch `codex/fix-update-and-invoice`; final commit recorded in Git history
- Delivery: v1.1.84 release asset repaired immediately; hardened v1.1.85 pending merge, publish, and release
- Follow-up: on SUNMI, tap Check for updates and install v1.1.85; verify the Android installer opens

## 2026-10-06 — Use date-based receipt numbers without separators

- Agent: Codex
- Scope: paid Bill receipt-number allocation, historical receipt identifiers, Bill History example, and Android release
- Decision: use `LMYYYYMMDD001`; derive the date in Bangkok time, reset an atomic sequence to `001` each date, and omit all separators
- Verification: dedicated receipt workflow guard, full regression suite, production web build, Android build, and production database verification: 308 eligible/numbered/distinct, zero invalid formats, zero Bangkok-date mismatches, and unchanged paid-Bill total `฿136,278.00`
- Git: PR #64, merge commit `6c46e3d849a8fc7f031ce6594c68c2070499e904`
- Delivery: production migration applied; Lovable production published and live `LM20261006001` example verified; Android v1.1.84 released
- Follow-up: install the new Android release on SUNMI and verify the next paid receipt plus Bill History search/reprint

## 2026-10-06 — Add permanent receipt numbers and receipt retrieval

- Agent: Codex
- Scope: paid Bills, counter receipts, Bill History search, reprint, and email handoff
- Decision: assign one immutable `LM-########` number in PostgreSQL when a real Bill becomes paid; preserve the existing durable print path; allow all-history lookup by receipt number and prepare a complete receipt email in the device mail app
- Verification: dedicated receipt workflow guard, full regression suite, production web build, and Android build
- Git: PR #62, merge commit `7c5c5d13a495afdaac7e779496d6b49ffe07f83a`
- Delivery: production migration applied and verified for 307 paid Bills with zero duplicate/missing numbers; Lovable production published and live assets verified; Android v1.1.83 released
- Follow-up: install v1.1.83 on SUNMI and verify one new checkout, receipt-number search, reprint, and device email handoff; Thai Full Tax Invoice remains separate because it requires customer legal name/address/Tax ID and statutory invoice rules

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
