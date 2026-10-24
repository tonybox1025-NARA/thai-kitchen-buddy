# Shared AI Change Log

## 2026-10-24 — Use Manager's current shift on POS Live

- Agent: Codex
- Scope: POS Live attendance response/display and a build-enforced regression guard.
- Decision: prefer Manager's `display_shift` value and retain the old local clock-in inference only as backward compatibility for an older Manager function response. This shows the temporary 15:00–02:00 window without altering raw fingerprint times, payroll calculations or attendance rows.
- Verification: dedicated Live guard, AI protocol guard, TypeScript, the full build-enforced regression suite and production build pass with the canonical Bun lock.
- Git: `codex/live-manager-shift-20261024`, based on `origin/main` `144bf2f`.
- Delivery: source prepared; merge, Lovable publish and authenticated Live verification remain separate until completed. No Android update is required for the web Live page.
- Follow-up: deploy the matching Manager function first, then publish POS and confirm one Live attendance row shows 15:00–02:00.

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

## 2026-10-23 — Archive resigned staff; history no longer blocks removal

- Agent: Claude Code
- Scope: `supabase/migrations/20261023130000_staff_archive_and_history_fks.sql` (applied to prod `36755238-...` via Lovable connector), `src/routes/_app/settings.tsx` (staff manager).
- Decision: a resigned staff member could not be deleted — `orders_staff_debtor_id_fkey` (and other references from bills/voids/shifts/etc.) blocked it, which is correct since those records, including cancelled/voided ones, must stay as history. So staff are now **archived (deactivated)** rather than deleted: the Settings staff list shows only active staff; the trash button archives (admin-PIN gated `set_staff_active`) instead of hard-deleting; a new "Inactive / Resigned" section lists archived staff with Reactivate and a Delete-permanently option. Separately, every nullable "action-by" FK to `staff` (14 of them: orders.staff_debtor_id/opened_by/closed_by, bills.cashier_id, order_items.voided_by, shifts.*, voids.voided_by, etc.) was changed to `ON DELETE SET NULL` so a true delete keeps the record and only clears the staff link. Owner/approver NOT-NULL FKs (staff_tab_charges.staff_id, staff_tab_settlements.staff_id, emergency_menu_price_changes.requested_by/approved_by) intentionally stay RESTRICT. Also: staff LEK (resigned) was archived; their ฿15 staff tab was already `voided` (not outstanding), so no balance is affected.
- Verification: `tsc --noEmit` clean. Post-change DB readback: `list_staff_profiles()` returns 14 active (no LEK); `staff.active=false` for LEK; 20 staff FKs now `ON DELETE SET NULL`, 4 remain RESTRICT by design. POS LIVE and attendance untouched.
- Git: `claude/staff-archive` off `origin/main@c97385c`.
- Delivery: DB changes applied to production and verified; frontend source ready — merge + Lovable publish + live verification pending at this checkpoint. SUNMI APK update only needed if staff management is used on-device (Tony manages staff on web).
- Follow-up: none. Future resignations are self-serve (archive); reactivate or permanently delete from the Inactive section.

## 2026-10-22 — Deliver actual transferred totals including tips

- Agent: Codex
- Scope: production delivery and live verification of the Bill and Sales History transferred-total display recorded below.
- Decision: publish the read-only display correction while keeping bill payments and tips separate in accounting and leaving all stored data and reconciliation calculations unchanged.
- Verification: Lovable synced merge commit `45dae0c`; production identifies deployment `5fa514a6-927f-485b-9ef6-a656d371b285`. The live Bill bundle contains `Bill payment`, `Tip`, and `QR Transfer`, while the live Reports bundle contains actual QR/card received plus bill/tip breakdown markers.
- Git: feature commit `5f6ed48`; merged to `main` as `45dae0c` through PR #90.
- Delivery: live at `https://thai-kitchen-buddy.lovable.app`; no database, payment record, Edge Function, or installed SUNMI Android app was changed.
- Follow-up: none for the web workflow; refresh the open Bill or Reports page before checking.

## 2026-10-22 — Show the actual transferred amount including tips

- Agent: Codex
- Scope: POS Bill detail, Bill History payment badges, Sales History tip summary, and the Bill History regression guard.
- Decision: keep bill payment and tip accounting separate, but display the actual QR/card amount received as payment plus tip. Bill detail and Bill History also retain the bill/tip breakdown, so a ฿724 bill plus ฿26 tip is visibly a ฿750 transfer.
- Verification: Bill History regression guard, AI protocol guard, TypeScript, full build-enforced regression suite, and production build passed with the frozen Bun lock; merge and live-bundle checks remain for delivery.
- Git: `codex/show-total-qr-received`; exact commit is reported with delivery.
- Delivery: source work only at this entry; no database, payment record, reconciliation calculation, Lovable production, or SUNMI Android change.
- Follow-up: finish validation, merge, publish Lovable, and verify the live Bill and Reports bundles.

## 2026-10-22 — Deliver Sales and Bill History tip visibility

- Agent: Codex
- Scope: production delivery and live verification of the Sales History and Bill History tip display recorded below.
- Decision: publish the read-only tip visibility update without changing any saved payment, sales total, cash payout calculation, database object, or Android package.
- Verification: Lovable synced merge commit `3c30b3b`; the production response identifies deployment `324568de-0e33-4e4a-9771-643616accebf`, and the live Reports bundle contains the QR, card, total, and per-payment tip markers plus the `tip_amount` Bill History query.
- Git: feature commit `a687e8d`; merged to `main` as `3c30b3b` through PR #88.
- Delivery: live at `https://thai-kitchen-buddy.lovable.app`; no production database, Edge Function, or installed SUNMI Android app was changed.
- Follow-up: none for the web workflow; refresh Reports before first use.

## 2026-10-22 — Show tips in Sales and Bill History

- Agent: Codex
- Scope: POS Reports Sales History, Bill History payment badges, and the Bill History regression guard.
- Decision: show QR tips, card tips, and total tips separately from sales in every Sales History period, and show each saved payment tip beside its tender in the Bill History list. Existing sales, tender, payout, and reconciliation calculations remain unchanged.
- Verification: Bill History regression guard, AI protocol guard, TypeScript, full build-enforced regression suite, and production build passed with the frozen Bun lock. Targeted repository lint still reports the existing whole-file Prettier backlog in `reports.tsx`; the focused diff was reviewed without reformatting unrelated code.
- Git: `codex/show-history-tips`; exact commit is reported with delivery.
- Delivery: source work only at this entry; no database, payment record, Lovable production, or SUNMI Android change.
- Follow-up: merge, publish Lovable, and verify the live Sales History and Bill History bundles.

## 2026-10-22 — Deliver Bill History read-only details to production

- Agent: Codex
- Scope: production delivery and live verification of the paid-Bill detail route recorded below.
- Decision: merge the tested read-only Bill History detail screen and publish it to the POS web app without changing payment, checkout, database, or SUNMI Android behavior.
- Verification: the full regression suite and production build passed before merge; the published Reports bundle routes Bill History to `/bill/$billId`, and the published Bill bundle contains the order and payment-detail views.
- Git: feature commit `628d32f`; merged to `main` as `37c765d` through PR #86.
- Delivery: Lovable deployment `6e45a318-dce5-4060-88cd-1de76ab277f9` is live at `https://thai-kitchen-buddy.lovable.app`; the production response identifies that deployment. No production database, Edge Function, or installed SUNMI Android app was changed.
- Follow-up: none for the web workflow; refresh the Reports page before the first live use.

## 2026-10-21 — Open Bill History in a read-only detail screen

- Agent: Codex
- Scope: POS Reports Bill History, a new paid-Bill detail route, and a build-enforced regression guard.
- Decision: replace the Bill History link to the SUNMI-only checkout screen with a separate read-only detail page showing order items, discounts, totals, tender records, cash/change details, tips, and refunds. The payment route and all checkout behavior remain unchanged.
- Verification: dedicated Bill History guard, full regression suite, TypeScript, targeted lint, and production build passed using the frozen Bun lock.
- Git: `codex/bill-history-readonly-detail`; exact commit is reported with delivery.
- Delivery: isolated source work only while the restaurant is open; no production database change, Lovable publication, Edge Function deployment, merge to main, or SUNMI update.
- Follow-up: after closing and owner approval, merge and publish the tested source, then verify one Bill History entry on the live app.

## 2026-10-20 — Shared device PIN production delivery and Android v1.1.90

- Agent: Codex
- Scope: POS bridge function, POS/Live web publication, Android version 1.1.90, and production verification.
- Decision: deploy the merged PIN bridge only after the Manager central function passed; publish POS and Live from the verified GitHub main; package the same application code for SUNMI as v1.1.90.
- Verification: production POS `shared-pin-auth` returned HTTP 200 with `configured=false`, `version=0`, proving the Manager bridge; published POS bundle contains the shared-PIN client; full regression/build and APK certificate/checksum verification are recorded with the release.
- Git: production function used merged source `976d123`; Lovable's preview-only tuple type correction is in `06522ad`; Android release commit is the commit containing this entry.
- Delivery: POS Edge Function deployed to `sbjzbphdjfpjvjbzjuzk`; Lovable deployment `83bd8f6a-4d74-4c5b-bf57-d9bb18ce9db6` published to `https://thai-kitchen-buddy.lovable.app`; Android v1.1.90 released as `LONMOH-POS-v1.1.90.apk` with versionCode 92, the same signing certificate as v1.1.89, and SHA-256 `810b20f1d40eb775a6246ae9102591b1854f312c4b52ca434ffb75c8007d5c1e`.
- Follow-up: set the first shared PIN in Manager, install v1.1.90 on SUNMI, then verify one real POS login and one Live login.

## 2026-10-19 — One shared device PIN for POS, Live and Manager

- Agent: Codex
- Scope: POS authentication provider and login/staff-selection screens, Live route access, central Manager PIN bridge, and a build-enforced regression guard.
- Decision: remove normal email/password entry after initial setup; choose a staff name and use the same owner-controlled 6-digit PIN as Manager. Keep a persistent device session, require the changed PIN once per device, preserve selected staff attribution, rate-limit failed central verification, and keep valid sessions through slow or offline startup.
- Verification: all POS regression guards, TypeScript, targeted lint with no errors, and the production web build passed using the canonical frozen Bun lock.
- Git: `codex/shared-pin-device-login`; exact commit is reported with delivery.
- Delivery: source only at this entry. POS Edge Function, frontend publication, Android release and real POS/Live verification are pending production deployment.
- Follow-up: deploy after the Manager shared-PIN database/function, publish, release Android, and verify one real POS login and one Live login.

## 2026-10-18 — Preserve staff menu availability during Manager publication

- Agent: Codex
- Scope: catalog receiver, POS device catalog refresh, staff menu availability controls, and build-enforced availability regression tests.
- Decision: existing POS menus receive catalog-only UPDATEs that omit both availability fields, so a staff pause or reopen during publication cannot be overwritten by an earlier snapshot. New rows alone receive Manager initial visibility. Missing existing targets fail instead of recreating an open menu. Staff pauses immediately invalidate the device snapshot; active order screens refresh on resume, reconnect and every 30 seconds, with explicit offline warnings and retries.
- Verification: implementation checkpoint; executable isolated Edge Function and device-cache tests added, full regression suite and production build pending.
- Git: `codex/diagnose-menu-publish-availability`; see the commit containing this entry.
- Delivery: source checkpoint only; production function/web/APK deployment and live verification pending. No production menu availability was changed during development.
- Follow-up: finish validation, publish receiver/frontend, and report device delivery separately.

### Availability fix — validated source checkpoint

- The executable receiver tests pass for all POS/QR flag combinations, concurrent staff pause/reopen, repeated publishes, legacy-ID/name matching, new/hidden/SET-child menus, dry runs, denied writes and disappearing target rows. Device tests pass for request sharing, freshness, local pause, stale-response rejection, offline failure/recovery and subsequent same-launch refreshes. The full build-enforced regression suite and production web build pass using the committed `bun.lock` (`bun install --frozen-lockfile`); the older npm lock is out of sync and was left unchanged.
- Repository-wide TypeScript and targeted lint still report pre-existing errors in unchanged reporting/receipt code and an unchanged settings expression. No application dependencies or unrelated generated routing files are included in this fix.
- Direct HTTPS push to the canonical Tony repository is denied for the connected `jeneraeda-del` account. A same-name feature branch was pushed to its GitHub fork and linked as canonical PR #81 so the source is reviewable and shared. Deployment remains pending at this checkpoint.

## 2026-10-17 — Recover confirmed T15 QR payment from close review

- Agent: Codex
- Scope: one production POS order on business day 2026-10-16, its Bill/QR tender, saved Z-report totals, receipt number, and manager-review record
- Decision: Tony confirmed that T15's 2 salted eggs plus 3 rice soups were paid by QR; reconstruct one ฿66 paid Bill and one QR payment through the normal payment/finalization triggers, update only the affected saved Z totals, and retain the original warning as a reviewed audit record
- Verification: authoritative production reads show exactly one ฿66 Bill, exactly one ฿66 QR payment, receipt `LM20261017029`, closed order and shift, Z gross ฿11,296, net ฿11,031, QR ฿7,787, 33 Bills, late QR bucket ฿2,921 across 7 payments, and zero pending close-review records
- Git: `codex/repair-qr-tender-20261016`; see the commit containing this entry
- Delivery: guarded production data repair completed; no application code, schema, Lovable publish, or Android update was required
- Follow-up: if Manager App Daily Sales for 2026-10-16 was imported before this repair, import that POS day again so it receives the corrected totals

## 2026-10-16 — Route Side / Extra items to the kitchen printer

- Agent: Codex
- Scope: POS and customer-QR order ticket routing, Side / Extra category zone assignment, routing regression guard, and Android release
- Decision: make explicit kitchen-zone assignments override legacy name-based front-counter fallbacks and assign `➕ เครื่องเคียง / EXTRA` to Main Kitchen, so its seven side items print in the kitchen while remaining on the counter FOOD checklist
- Verification: dedicated Extra routing guard, full regression suite, production web build, Android build, production category readback, and deployed-asset inspection; physical SUNMI ticket verification remains the exact follow-up below
- Git: PR #78, merge commit `62c52dbe9dbec3dd88846097916b627e65d9c918`
- Delivery: production category mapped to Main Kitchen; Lovable deployment `31eada94-2852-489c-b5a9-0d72487894d3` published from the merge commit; Android v1.1.89 released with matching signing certificate and SHA-256 `58c6c3d530807a9d8832b69790c59af14ff017ac7eab3862d61579be57a4ae3f`; physical SUNMI ticket test remains
- Follow-up: order one Extra item on SUNMI and confirm it prints once in the kitchen and once on the counter FOOD checklist

## 2026-10-13 — Restore confirmed credit-card tender after close review

- Agent: Codex
- Scope: one production POS Bill on business day 2026-10-12, its closed-shift tender summary, and the associated manager-review record
- Decision: the ฿180 Bill and customer payment were confirmed complete, but the payment row was missing; restore one ฿180 card tender, preserve the original Bill total and paid timestamp, update only the closed shift's card-method total, and retain the original mismatch evidence as a reviewed audit record
- Verification: authoritative production reads show Bill paid ฿180, one card payment totaling ฿180, order closed, shift closed with card total ฿180, zero pending close-review records, and no existing 2026-10-12 Daily Sales import in Manager App requiring correction
- Git: `codex/repair-card-tender-20261013`; see the commit containing this entry
- Delivery: guarded production data repair completed; no application code, schema, Lovable publish, Android build, or SUNMI update was required
- Follow-up: none

## 2026-10-10 — Remove duplicate standalone crispy-pork water mimosa

- Agent: Codex
- Scope: POS menu row `b2ce3973-9102-4cbd-8417-99a8e7169f26` linked to the newly added Manager menu `defc5eb1-f513-4bb8-8db7-41ec36208c48`
- Decision: remove the separate ฿108 `ผัดกระเฉดหมูกรอบ` menu at the owner's request and retain the existing ฿69 `ผัดกระเฉดไฟแดง` menu with its two add-on groups, including crispy pork +฿39
- Verification: the removed row had zero order items, menu add-ons, menu ingredients, and emergency price changes; guarded exact-ID deletion returned one row; post-delete production and live QR-menu reads retain ฿69, its two add-on groups, and no ฿108 row
- Git: `codex/remove-crispy-water-mimosa-20261010`; see the commit containing this entry
- Delivery: production POS data updated directly; no schema, web code, Lovable publish, Android build, or SUNMI update required
- Follow-up: none

## 2026-10-09 — Emphasize the Z report sales date

- Agent: Codex
- Scope: printed Z report header and regression guard
- Decision: show the Bangkok business day as a large bilingual `SALES DATE / วันที่ขาย` value, while labeling the later timestamp explicitly as `CLOSED / ปิดกะ`, so an after-midnight close cannot be mistaken for the sales date
- Verification: dedicated Z report header guard, full regression suite, and production build
- Git: `codex/emphasize-z-business-day`; see the commit containing this entry
- Delivery: PR #72 merged; Lovable deployment `0a706489-a56e-4726-b2af-dba9ca2be3c2` published and its live print asset verified; Android v1.1.88 released as `LONMOH-POS-v1.1.88.apk`; SUNMI physical-print verification remains pending
- Follow-up: print one Z report on SUNMI and confirm the date hierarchy on paper

## 2026-10-09 — Simplify the customer receipt layout

- Agent: Codex
- Scope: SUNMI counter receipt, printable/PDF receipt, receipt regression guard, and Android release
- Decision: remove the customer-facing non-VAT disclaimer, label the LM identifier as `เลขที่ใบเสร็จรับเงิน`, and place the customer's Tax ID between the customer name and address
- Verification: customer-receipt regression guard, full regression suite, production build, Android bundle/build, live receipt asset inspection, and v1.1.87 APK manifest/checksum inspection
- Git: PR #70, merge commit `340e1fcd5e6baccacb696e710c02197c929cabac`
- Delivery: merged and published to Lovable production; Android v1.1.87 released as `LONMOH-POS-v1.1.87.apk`; SUNMI physical print remains unverified
- Follow-up: print one customer receipt on SUNMI and confirm the physical layout

## 2026-10-07 — Add searchable customer receipt documents

- Agent: Codex
- Scope: receipt search page, customer and seller receipt records, counter reprint, A4 print/PDF save, navigation, database policy, and Android release
- Decision: reuse each paid Bill's immutable `LMYYYYMMDD001` number; issue only `ใบเสร็จรับเงิน / RECEIPT` while ABOUT TIME CO., LTD. is not VAT registered; lock seller details and let staff enter only customer details
- Verification: dedicated customer-receipt guard, changed-file lint, full regression suite, production web build, live `/receipts` asset inspection, Android build, and v1.1.86 manifest/asset checksum inspection
- Git: PR #68, merge commit `699f19221016d58abb7a299ed3a21113175e2270`
- Delivery: production migration applied and policy/settings verified; Lovable deployment `479312f5-9ae3-447a-ac42-f0e7aa1f0300` published; live route/assets verified; Android v1.1.86 released as `LONMOH-POS-v1.1.86.apk`
- Follow-up: install v1.1.86 on SUNMI and verify one real LM lookup, customer-data save, counter print, and Print / Save PDF on the operating devices

## 2026-10-07 — Keep the Android update action visible

- Agent: Codex
- Scope: GitHub Android release asset, in-app update APK discovery, missing-package feedback, and Android release
- Decision: publish POS APKs as `LONMOH-POS-vX.Y.Z.apk`; also accept exactly one non-Print-Bridge APK so a harmless upload filename mismatch cannot hide the update button
- Verification: dedicated updater regression guard, full regression suite, production web build, Android build, GitHub v1.1.85 asset name/checksum inspection, and live production asset verification
- Git: PR #66, merge commit `c602f957dfee7f4ca9ef6f80cfd03c0fa7abaacd`
- Delivery: v1.1.84 release asset repaired immediately; hardened v1.1.85 merged, Lovable production published, and Android release uploaded as `LONMOH-POS-v1.1.85.apk`
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
