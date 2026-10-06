
# Thai Kitchen Buddy POS — Agent Instructions

<!-- AI_PROTOCOL:REQUIRED -->

## Mandatory shared workflow

Before analyzing, editing, testing, deploying, or changing production data:

1. Read [`docs/AI_COLLABORATION_PROTOCOL.md`](docs/AI_COLLABORATION_PROTOCOL.md) completely.
2. Confirm this checkout belongs to `https://github.com/tonybox1025-NARA/thai-kitchen-buddy.git` and start from the latest `origin/main`, never from a stale local `main`.
3. Inspect relevant history, current diffs, remote Codex/Claude work branches, and [`docs/AI_CHANGELOG.md`](docs/AI_CHANGELOG.md).
4. Preserve all user or other-agent work. Never reset, overwrite, discard, or silently replace it.
5. Run `npm run guard:ai-protocol` before handoff. For implementation work, also run the relevant tests and the build-enforced regression checks.

The shared protocol is mandatory for both Codex and Claude Code. If any instruction conflicts, follow the safer rule and stop before destructive or production-changing action.

## Tony's working principles

1. Give the direct conclusion first for simple questions.
2. Inspect the current state and relevant existing changes before acting.
3. Evaluate the major viable approaches together before proposing or starting work.
4. Present the single best option first and briefly explain why.
5. Mention alternatives only when outcome, risk, time, or cost materially differs.
6. Separate required work from optional improvements.
7. If evidence invalidates the approach, reassess the whole problem instead of stacking improvised fallbacks.
8. Complete the authorized flow through implementation, testing, deployment or publishing checks, and real-use verification; report each status separately.
9. Minimize Tony's required actions and ask only for decisions that materially change the result.

## POS operational invariants

- Operational native prints go through the print_jobs outbox (`enqueue_print_job`, `open_shift_safely`, `close_shift_with_ticket`) and are delivered only by the leased worker in `src/lib/native-print-queue.ts` — so paper failures never lose tickets or roll back business commits.
- Operational prints (rounds, receipts, voids, QR slips, X/Z/opening, reports) are recorded via enqueue_print_job / submit_pos_round_safely with deterministic job keys; printDirect is only for test prints and the cash drawer — so paper failures never lose tickets or duplicate them (checked by scripts/verify-no-direct-print.sh).
- Operational dates/times/ranges use src/lib/bkk-time.ts (Asia/Bangkok), never device timezone — owner views remotely; enforced by scripts/verify-bangkok-time.sh.
- Hourly sales/traffic displays use src/lib/business-hour-order.ts so every screen runs opening -> midnight -> closing, never 00:00 clock order; all build commands enforce scripts/verify-business-hour-order.mjs.
- Multi-day dashboard detail lists are grouped by shift business_day and sorted opening -> close inside each group; never merge different dates into a time-only list. The build-enforced business-hour verifier protects Gross, QR, Tips, Discounts and Voids details.
- Preserve verified operational behavior across later edits: inspect the existing implementation/history before replacing it, add or extend a regression guard for every operational bug fix, and run the build-enforced `npm run verify:regressions` suite before publishing.
- DashRangeBar opens in date-range mode; its first deliberate day click only stages the start without applying data or closing, and only the second day click applies the range and closes, enforced by scripts/verify-date-range-selection.mjs.
- Report and register history filters use the shared HistoryRangeBar (Today / Yesterday / This week / This month / Custom range); never add an inline range calendar that can apply or close on the first click.
- Customer QR devices are menu/ordering only. Crew devices are table/order service plus bill requests only. Member lookup or signup, loyalty selection, and payment UI belong only to the native SUNMI app. Selecting a reward may update the open Bill, but point deduction and earning must finalize together only after a successful payment; enforced by scripts/verify-terminal-only-loyalty.mjs.
- Every real paid Bill has one immutable database-issued `LMYYYYMMDD001` receipt number: Bangkok payment date plus an atomic daily sequence starting at `001`, with no separators. Never generate receipt numbers on a device, reuse them, or change them during reprint/refund. Bill History must retain all-history receipt-number lookup, and every original/reprinted customer receipt must use that stored number; enforced by scripts/verify-receipt-number-invoice.mjs.
- Customer receipt documents reuse the immutable LM Bill number and are ordinary `ใบเสร็จรับเงิน / RECEIPT` documents while `settings.vat_registered` is false. Never label or store them as tax invoices, add VAT claims, or introduce a second number sequence without confirmed ภ.พ.20 registration and a dedicated migration; enforced by scripts/verify-customer-receipts.mjs.
- Every Android release must upload the POS APK with a `LONMOH-POS-vX.Y.Z.apk` asset filename. The in-app updater must also accept a single non-Print-Bridge APK as a safe fallback and show an explicit error instead of silently hiding the update action; enforced by scripts/verify-app-update.mjs.
