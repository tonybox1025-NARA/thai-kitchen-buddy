-- Run inside a transaction and ROLLBACK; uses only test data.
BEGIN;
-- 1. Outbox idempotency: same key => same id, single row.
SELECT public.enqueue_print_job('verify:k1','counter','{"kind":"report"}'::jsonb) = public.enqueue_print_job('verify:k1','counter','{"kind":"report"}'::jsonb) AS same_job;
SELECT count(*) = 1 AS one_row FROM print_jobs WHERE job_key = 'verify:k1';
-- 2. Claim serializes per printer: second claim while leased returns nothing for counter.
SELECT count(*) >= 1 AS claimed FROM public.claim_print_jobs('dev-a');
SELECT count(*) FILTER (WHERE printer='counter') = 0 AS serialized FROM public.claim_print_jobs('dev-b');
-- 3. Failure schedules retry and stays pending (never abandoned).
SELECT public.fail_print_job((SELECT id FROM print_jobs WHERE job_key='verify:k1'),'dev-a','offline') > now() AS backoff;
SELECT status = 'pending' AND attempts = 1 AS still_pending FROM print_jobs WHERE job_key='verify:k1';
-- 4. Legacy worker marking failed is converted into a retry.
UPDATE print_jobs SET status='failed', error='old client' WHERE job_key='verify:k1';
SELECT status = 'pending' AS legacy_failed_retried FROM print_jobs WHERE job_key='verify:k1';
-- 5. Shift open idempotency (only when no shift is open).
SELECT (public.open_shift_safely(NULL, 0, current_date, '[{"printer":"counter","payload":{"kind":"report"}}]'::jsonb)->>'created') AS first_open;
SELECT (public.open_shift_safely(NULL, 0, current_date, '[{"printer":"counter","payload":{"kind":"report"}}]'::jsonb)->>'created') = 'false' AS second_adopts;
SELECT count(*) = 1 AS one_open_shift FROM shifts WHERE status='open';
SELECT count(*) = 1 AS one_opening_job FROM print_jobs WHERE source_type='opening' AND source_id=(SELECT id FROM shifts WHERE status='open');
-- 6. Close + Z ticket in one transaction; repeat adopts.
SELECT public.close_shift_with_ticket((SELECT id FROM shifts WHERE status='open'), NULL, '{}'::jsonb, '{}'::jsonb, '{"kind":"report"}'::jsonb)->>'closed' AS closed;
SELECT count(*) = 1 AS one_z_job FROM print_jobs WHERE job_key LIKE 'z:%' AND created_at >= now() - interval '1 minute';
-- 7. Integrity status is readable.
SELECT public.get_integrity_status();
ROLLBACK;

-- 8. Bill get-or-create is idempotent (pick any open order; rollback).
BEGIN;
SELECT public.get_or_create_bill(id) = public.get_or_create_bill(id) AS same_bill
FROM orders WHERE status = 'open' LIMIT 1;
ROLLBACK;

-- ── POS round / receipt / claim / shift checks (self-contained fixtures) ──
-- Run as a privileged role inside one transaction; everything is rolled back.
BEGIN;
DO $$
DECLARE
  v_table uuid; v_shift uuid; v_order uuid; v_i1 uuid; v_i2 uuid; v_sub uuid := gen_random_uuid();
  r1 record; r2 record; v_jobs int; v_a int; v_b int; v_open1 jsonb; v_open2 jsonb;
BEGIN
  -- Fixtures: test table + open shift (only if none open) + open test order with 2 unsent items.
  INSERT INTO restaurant_tables(code, capacity, is_test) VALUES ('ZZ-VERIFY-' || left(v_sub::text, 6), 2, true) RETURNING id INTO v_table;
  SELECT id INTO v_shift FROM shifts WHERE status = 'open' LIMIT 1;
  IF v_shift IS NULL THEN
    v_open1 := public.open_shift_safely(NULL, 0, current_date, '[{"printer":"counter","payload":{"kind":"report"}}]');
    v_open2 := public.open_shift_safely(NULL, 0, current_date, '[{"printer":"counter","payload":{"kind":"report"}}]');
    ASSERT (v_open1->>'created')::boolean AND NOT (v_open2->>'created')::boolean, 'repeat open must adopt';
    v_shift := (v_open1->'shift'->>'id')::uuid;
    ASSERT (SELECT count(*) FROM print_jobs WHERE source_type = 'opening' AND source_id = v_shift) = 1, 'exactly one OPENING job';
  END IF;
  INSERT INTO orders(table_id, shift_id, source, status, guests, is_test) VALUES (v_table, v_shift, 'pos', 'open', 2, true) RETURNING id INTO v_order;
  INSERT INTO order_items(order_id, name_th, name_en, name_my, qty, unit_price, status) VALUES (v_order,'a','a','a',1,10,'pending') RETURNING id INTO v_i1;
  INSERT INTO order_items(order_id, name_th, name_en, name_my, qty, unit_price, status) VALUES (v_order,'b','b','b',1,10,'pending') RETURNING id INTO v_i2;

  -- 1. POS round: first call commits; same-UUID retry returns original, no new prints.
  SELECT * INTO r1 FROM public.submit_pos_round_safely(v_sub, v_order, ARRAY[v_i1, v_i2],
    '[{"printer":"kitchen","payload":{"kind":"order_ticket"}},{"printer":"counter","payload":{"kind":"order_ticket"},"batch":true}]');
  SELECT count(*) INTO v_jobs FROM print_jobs WHERE job_key LIKE 'round:' || v_sub || ':%';
  SELECT * INTO r2 FROM public.submit_pos_round_safely(v_sub, v_order, ARRAY[v_i1, v_i2], '[{"printer":"kitchen","payload":{}}]');
  ASSERT r1.created AND NOT r2.created AND r1.round_number = r2.round_number AND r2.item_count = 2, 'same-key retry adopts';
  ASSERT v_jobs = 2 AND (SELECT count(*) FROM print_jobs WHERE job_key LIKE 'round:' || v_sub || ':%') = 2, 'retry adds no prints';
  ASSERT (SELECT count(*) FROM order_items WHERE order_id = v_order AND status = 'sent' AND round_number = r1.round_number) = 2, 'items sent in one round';
  -- 1b. A new UUID with already-sent items is rejected (no second round).
  BEGIN
    PERFORM public.submit_pos_round_safely(gen_random_uuid(), v_order, ARRAY[v_i1], '[]');
    RAISE EXCEPTION 'expected rejection';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected rejection' THEN RAISE; END IF;
  END;

  -- 2. Receipt idempotency: bill-derived key yields one job.
  PERFORM public.enqueue_print_job('receipt:' || v_order, 'counter', '{"kind":"receipt"}');
  PERFORM public.enqueue_print_job('receipt:' || v_order, 'counter', '{"kind":"receipt"}');
  ASSERT (SELECT count(*) FROM print_jobs WHERE job_key = 'receipt:' || v_order) = 1, 'one receipt per bill key';

  -- 3. Claim exclusivity: a second device cannot claim a printer that is leased.
  SELECT count(*) INTO v_a FROM public.claim_print_jobs('verify-dev-a');
  SELECT count(*) INTO v_b FROM public.claim_print_jobs('verify-dev-b') c
    WHERE c.printer IN (SELECT printer FROM print_jobs WHERE claimed_by = 'verify-dev-a' AND lease_until > now());
  ASSERT v_a >= 1 AND v_b = 0, 'claims are exclusive per printer';

  -- 4. Close + Z in one transaction; repeat adopts and adds no Z job.
  UPDATE order_items SET status = 'voided' WHERE order_id = v_order;
  UPDATE orders SET status = 'cancelled', closed_at = now() WHERE id = v_order;
  IF v_open1 IS NOT NULL THEN
    ASSERT (public.close_shift_with_ticket(v_shift, NULL, '{}', '{}', '{"kind":"report"}')->>'closed')::boolean, 'close';
    ASSERT (public.close_shift_with_ticket(v_shift, NULL, '{}', '{}', '{"kind":"report"}')->>'adopted')::boolean, 'repeat close adopts';
    ASSERT (SELECT count(*) FROM print_jobs WHERE job_key = 'z:' || v_shift) = 1, 'exactly one Z job';
  END IF;
  RAISE NOTICE 'reliability checks passed';
END $$;
ROLLBACK;
