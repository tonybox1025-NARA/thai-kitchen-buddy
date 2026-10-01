# Roadmap
- [x] Durable idempotent print outbox (job_key, attempts, backoff, claim) — no 30-min abandonment
- [x] claim/complete/fail print RPCs + native worker rewrite
- [x] open_shift_safely RPC + OPENING job in same tx
- [x] close_shift_safely v2 + Z job in same tx, adopt repeated calls
- [x] Route register/reports opening/Z through RPCs; reprint uses separate key
- [x] Verify table/QR/bill/move/combine entry points use safe RPCs
- [x] get_integrity_status RPC (read-only) + safe projection heal
- [x] Small non-blocking print-pending indicator
- [x] Verification SQL script
