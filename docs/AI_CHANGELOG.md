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

## 2026-10-04 — Shared Codex/Claude safety protocol installed

- Agent: Codex
- Scope: repository instructions, shared coordination protocol, and build-time instruction guard
- Decision: make Git history and this protocol the shared source of truth for Tony, the manager, Codex, and Claude Code
- Verification: `npm run guard:ai-protocol` and production build
- Git: see the commit that introduced this entry
- Delivery: repository workflow only; no POS behavior or production data changed
- Follow-up: none
