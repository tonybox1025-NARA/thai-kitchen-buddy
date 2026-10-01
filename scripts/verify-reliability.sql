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
