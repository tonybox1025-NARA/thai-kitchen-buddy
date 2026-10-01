# POS Reliability: Prevention-by-Construction Plan

## Audit findings (verified in current code/DB)

| Area | Current state | Gap |
|---|---|---|
| Print | `counter-printer.ts` `printDirect`/`printCounterJobs`/`printKitchenJobs`: in the APK with "direct" transport, tickets go **straight to the socket and are never recorded**. Only web/queue mode inserts `print_jobs`. | A failed or lost socket write loses the ticket for good. There's no idempotency key, so a retry or second tap prints again. |
| Print queue | `native-print-queue.ts`: every client subscribes and prints on INSERT. A `seen` Set only dedupes within one tab. It marks printed with `.eq(status,'pending')` *after* printing. Has a 30-min cutoff. Only retries failed jobs whose error looks like a connection error. | Two tablets can both print the same job. There's no claim/lease, attempt count, backoff or per-printer serialization across devices. Old jobs get abandoned. `print_jobs` has no `idempotency_key`, `attempts`, `claimed_by`, `next_attempt_at` or `source_ref`. |
| Shift open | `register.tsx:444` and `reports.tsx:516` select-then-insert on the client, with a 23505 fallback. The opening ticket is printed with `printDirect` after the insert. Failure shows the toast "Check paper/power, then tap Retry print". | Not an RPC. The opening ticket isn't durable. Staff have to do manual recovery. |
| Shift close | `close_shift_safely` locks and stores totals. `prevent_unsafe_shift_close` trigger exists. | Totals are computed on the client. The Z ticket is printed outside the transaction. A repeat tap returns `already_closed` and shows the error "refresh the page" instead of adopting the result. |
| Single open shift | `shifts_only_one_open_idx` unique index exists. | OK. |
| Table order | `open_table_order_safely` (advisory lock + unique `orders_one_open_order_per_table_idx`) is used by POS and QR. | OK for creation. |
| Submission | QR uses `submit_order_round_safely` (keyed by `order_submissions`, items and print jobs in one transaction). POS `order.$orderId.tsx:511` calls `allocate_order_round`, then a client `update order_items set status='sent'`, then prints directly. | POS isn't idempotent or atomic, and tickets aren't durable. The two paths differ. |
| Bills | Unique bill per order (`20261001060000`). But bills are inserted on the client in `order.$orderId.tsx:655` and `checkout.$tableCode.ts:119`. | There's no single `get_or_create_bill` RPC. Subtotal/VAT are computed on the client. |
| Live DB right now | 0 open shifts, 0 pending jobs, 1 failed job, 0 table drift, **7 open bills whose order is not open** (orphan/inert). | The dashboard doesn't show these. |
| Dashboard | `dashboard.tsx` counts derived from client queries. | It isn't an integrity source. |

## Design

### 1. Durable print outbox (all operational prints)
- Migration: add columns to `print_jobs`: `idempotency_key text unique`, `source_type text` (opening/z/kitchen/counter/receipt/qr), `source_id uuid`, `attempts int default 0`, `last_error`, `claimed_by text`, `claimed_at`, `lease_until`, `next_attempt_at default now()`, `printer_target text`. Keep `status` enum values. Add `printing` handling through `lease_until` instead of a new enum value, so old clients still work.
- Deterministic keys: `opening:{shift_id}`, `z:{shift_id}`, `round:{order_id}:{round}:{printer}:{zone}`, `receipt:{bill_id}:{payment_seq}`, `qr:{submission_id}:{n}`. Inserts use `ON CONFLICT (idempotency_key) DO NOTHING`.
- Every business RPC (shift open/close, round submit, bill finalize) inserts its jobs **in the same transaction**. Printer state can never roll back a commit.
- Client `printDirect` stays available only for test prints and the cash drawer. Operational calls switch to "enqueue + nudge the local worker".

### 2. Native print worker (claim/lease)
- New RPC `claim_print_jobs(p_device text, p_printers printer_kind[], p_limit int)`: `UPDATE … WHERE id IN (SELECT … WHERE status='pending' AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED)`. Sets the lease to 60s. Per-printer serialization means one active lease per `printer_target`.
- `complete_print_job(id, device, ok, error)`: on success sets printed and `printed_at`. On failure, `attempts+1` and exponential backoff (2s → 5 min cap), and it stays `pending`. After N attempts the job is still retried, with the backoff capped. No terminal abandonment.
- Rewrite `native-print-queue.ts`: a claim loop driven by realtime nudges, a 4s poll, focus/resume and boot. Remove the 30-min cutoff. A stable device id lives in localStorage. One device can be a "print host" (setting); the others only claim if the host's lease is stale. Leases make multi-client double printing impossible.
- Wake/one-shot TCP send stays native (`PosPrinterPlugin.kt` unchanged), so this works on APK v1.1.75 without a rebuild.

### 3. Shift RPCs
- `open_shift_safely(p_request_key uuid, p_opened_by, p_opening_float, p_cash_count)`: advisory lock. Adopts an existing open shift, or inserts one. Enqueues `opening:{shift_id}` jobs (counter + kitchen check). Returns `{shift, created}`.
- `close_shift_safely` v2 (same name, new overload with `p_request_key`): computes authoritative totals **server-side** from a new `compute_shift_totals(shift_id)`, which mirrors the current `buildReport` math so totals stay identical. Stores cash count and totals, enqueues `z:{shift_id}`. If already closed by the same shift it returns `{closed:true, adopted:true, totals}`, not an error.
- Blockers: before refusing, `close_shift_safely` auto-heals safe cases (see section 5). It refuses only for genuine open orders or bills with money.
- `register.tsx` and `reports.tsx` call the RPCs. Remove the "Retry print" UX, which is replaced by the outbox.

### 4. Orders, submission, bills
- POS uses a new `submit_pos_round_safely(p_submission_id, p_order_id, p_item_ids uuid[], p_print_jobs jsonb)`. It shares its internals with `submit_order_round_safely`: allocate round, mark sent, insert keyed jobs, all in one transaction, keyed by the `order_submissions` id. The client generates the submission id once per send tap and reuses it on retries.
- `get_or_create_bill(p_order_id)`: locks the order, returns the existing bill or inserts one with server-computed subtotal/VAT. It's used by `order.$orderId.tsx ensureBill` and `checkout.$tableCode.ts`.
- Move/combine: keep `move_table_order_safely` and `combine_open_table_orders`. Add a check that combine also folds the source's open inert bill into an audited void (no delete).

### 5. Self-healing (silent, audited)
New `integrity_heal()` SECURITY DEFINER. It's called by `open_shift_safely`, `close_shift_safely` and the worker every 5 min, and every action is written to a new `integrity_heal_audit` table:
- Inert open bill (no payments/discounts/loyalty/refunds, order not open or no live items) → set status to `void`. This needs a new enum value, so as a compatibility measure I'll use an `archived_at` column instead and exclude it from blockers/reports, with a snapshot in the audit. Nothing is deleted. This covers the 7 existing orphan bills.
- Table projection drift → recompute from open order (the trigger exists, the heal just touches rows).
- Expired print leases → released.
- An open order with zero live items, no bill money and older than X → closed as `cancelled` with an audit record.
- Anything involving money (paid partial, open order with items at Z) is **not** healed and is surfaced to the owner.

### 6. Authoritative integrity status
`get_integrity_status()` returns jsonb: `open_shifts` count (must be 0 or 1), `table_projection_mismatches`, `duplicate_open_orders`, `orphan_open_bills` (inert vs with money), `orders_without_shift`, `print_backlog` per printer (pending, oldest age, max attempts), `last_heal_at`, plus `owner_actions[]` (only non-automatic accounting items). The dashboard shows one owner-only badge (admin/manager role). Staff screens never show it.

### 7. Financial safety
- No DELETE on bills/payments/orders. Heals only flip state, and the audit table holds full snapshots.
- `compute_shift_totals` is validated against the stored `totals` of the last 30 closed shifts before switching. Any diff blocks rollout.

## Files to change
- Migrations (new, in order): `…_print_outbox_columns.sql`, `…_print_claim_rpcs.sql`, `…_shift_rpcs_v2.sql` (`open_shift_safely`, `compute_shift_totals`, `close_shift_safely` overload), `…_pos_round_and_bill_rpcs.sql` (`submit_pos_round_safely`, `get_or_create_bill`), `…_integrity_heal_status.sql` (`integrity_heal`, `get_integrity_status`, audit table, `bills.archived_at`). Each includes GRANT/RLS and REVOKE from anon.
- `src/lib/counter-printer.ts` (enqueue API, keep direct for test/drawer), `src/lib/native-print-queue.ts` (rewrite as claim worker), `src/lib/shift-close.ts`, `src/routes/_app/register.tsx`, `src/routes/_app/reports.tsx`, `src/routes/_app/order.$orderId.tsx` (send + ensureBill + receipt enqueue), `src/routes/_app/payment.$billId.tsx` (receipt enqueue key), `src/routes/api/public/qr-order.ts` (add keys to jobs), `src/routes/api/public/checkout.$tableCode.ts` (bill RPC), `src/routes/_app/dashboard.tsx` (owner integrity badge), `src/routes/_app/settings.tsx` (print host toggle), `scripts/print-bridge.js` (use claim/complete RPCs).

## Compatibility risks
- **APK v1.1.75**: the native plugin is unchanged. All logic is in web code loaded from the published URL, so no rebuild is needed. If the APK bundles web assets offline (check `capacitor.config.ts` `server.url`), old bundled JS keeps direct printing until it updates.
- **Old cached web/PWA clients**: they still insert `print_jobs` without a key. Columns are nullable/defaulted, so inserts keep working. Old workers that print on INSERT can double-print against new claimers. Mitigation: a BEFORE INSERT trigger derives `idempotency_key` when it's null, and old workers' `.eq(status,'pending')` update stays harmless. Bump the `sw.js` cache version to force an update, and only enable the "print host" mode after all devices report the new version.
- Old clients doing direct `shifts` insert or direct `bills` insert are still guarded by the unique indexes. A trigger also enqueues the opening job on shift insert and the Z job on close, so even old code gets durable prints.
- New `close_shift_safely` is an overload, so the old signature stays valid.
- `bills.archived_at` must be excluded in every report query. Audit `reports.tsx`, `register.tsx`, `dashboard.tsx` and the `daily-summary`/`item-sales` APIs so totals don't change (archived bills are unpaid, so totals are unaffected).

## Staged test plan (before publish)
1. **SQL unit (test rows with `is_test=true`)**: concurrent `open_shift_safely` ×5, giving 1 shift and 1 opening job. Repeat close gives the adopted result and 1 Z job. `submit_pos_round_safely` with the same key ×3 gives 1 round and N jobs. `get_or_create_bill` parallel gives 1 bill. Two `claim_print_jobs` sessions never return the same id.
2. **Totals parity**: `compute_shift_totals` vs stored `totals` for the last 30 shifts, which must be equal.
3. **Heal dry-run**: `integrity_heal(p_dry_run=true)` lists the 7 orphan bills. Review, then run for real and verify the audit rows.
4. **Browser (Playwright, signed in)**: open shift → job row exists with a key. Send round with the network dropped mid-call → retry → no duplicate. Z close double-tap.
5. **Device (APK 1.1.75)**: printer unplugged, then open shift/send orders → commits succeed → plug in → all tickets print once, in order. Kill the app mid-job → after relaunch the lease expires and the job prints once. Run two tablets at once → no duplicates.
6. Publish only after steps 1–5 pass. Keep the old code paths behind a settings flag for one business day.
