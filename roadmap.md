# Roadmap
- [ ] Durable idempotent print outbox (job_key, attempts, backoff, claim) — no 30-min abandonment
- [ ] claim/complete/fail print RPCs + native worker rewrite
- [ ] open_shift_safely RPC + OPENING job in same tx
- [ ] close_shift_safely v2 + Z job in same tx, adopt repeated calls
- [ ] Route register/reports opening/Z through RPCs; reprint uses separate key
- [ ] Verify table/QR/bill/move/combine entry points use safe RPCs
- [ ] get_integrity_status RPC (read-only) + safe projection heal
- [ ] Small non-blocking print-pending indicator
- [ ] Verification SQL script
