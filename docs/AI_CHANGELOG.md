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
