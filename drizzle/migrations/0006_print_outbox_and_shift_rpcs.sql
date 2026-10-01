-- Durable print outbox: every operational native print is recorded first,
-- keyed deterministically, and delivered by a leased worker with retries.
ALTER TABLE public.print_jobs
  ADD COLUMN IF NOT EXISTS job_key text,
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS claimed_by text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_until timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS print_jobs_job_key_idx ON public.print_jobs(job_key) WHERE job_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS print_jobs_due_idx ON public.print_jobs(printer, next_attempt_at, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS print_jobs_batch_idx ON public.print_jobs(batch_id) WHERE batch_id IS NOT NULL;

-- Older cached workers mark a failed outbox job 'failed' directly, which would
-- strand it. Convert that into a scheduled retry instead (outbox jobs only).
CREATE OR REPLACE FUNCTION public.print_jobs_keep_outbox_retrying()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.job_key IS NOT NULL AND OLD.status = 'pending' AND NEW.status = 'failed'
     AND coalesce(current_setting('app.print_rpc', true), '') <> 'on' THEN
    NEW.status := 'pending';
    NEW.attempts := OLD.attempts + 1;
    NEW.last_error := coalesce(NEW.error, OLD.last_error);
    NEW.lease_until := NULL;
    NEW.next_attempt_at := now() + make_interval(secs => least(300, power(2, least(OLD.attempts + 1, 9))));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS print_jobs_keep_outbox_retrying ON public.print_jobs;
CREATE TRIGGER print_jobs_keep_outbox_retrying BEFORE UPDATE OF status ON public.print_jobs
FOR EACH ROW EXECUTE FUNCTION public.print_jobs_keep_outbox_retrying();

-- Idempotent enqueue. Same key => same job, never a second ticket.
CREATE OR REPLACE FUNCTION public.enqueue_print_job(
  p_job_key text, p_printer public.printer_kind, p_payload jsonb,
  p_source_type text DEFAULT NULL, p_source_id uuid DEFAULT NULL, p_batch_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_job_key IS NULL OR length(trim(p_job_key)) = 0 THEN RAISE EXCEPTION 'job_key required'; END IF;
  INSERT INTO public.print_jobs(printer, payload, status, job_key, source_type, source_id, batch_id)
  VALUES (p_printer, p_payload, 'pending', p_job_key, p_source_type, p_source_id, p_batch_id)
  ON CONFLICT (job_key) WHERE job_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN SELECT id INTO v_id FROM public.print_jobs WHERE job_key = p_job_key; END IF;
  RETURN v_id;
END $$;

-- Claim at most one job (or one batch) per printer. A printer with a live
-- lease is skipped, so printers stay serialized across every till.
CREATE OR REPLACE FUNCTION public.claim_print_jobs(p_device text, p_lease_seconds integer DEFAULT 90)
RETURNS SETOF public.print_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_printer public.printer_kind; v_job public.print_jobs;
BEGIN
  IF p_device IS NULL OR length(p_device) = 0 THEN RAISE EXCEPTION 'device required'; END IF;
  FOREACH v_printer IN ARRAY enum_range(NULL::public.printer_kind) LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended('print:' || v_printer::text, 0)) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.print_jobs WHERE printer = v_printer AND status = 'pending' AND lease_until > now()) THEN CONTINUE; END IF;
    SELECT * INTO v_job FROM public.print_jobs
      WHERE printer = v_printer AND status = 'pending' AND next_attempt_at <= now()
      ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    RETURN QUERY
      UPDATE public.print_jobs SET claimed_by = p_device, claimed_at = now(),
        lease_until = now() + make_interval(secs => greatest(15, p_lease_seconds))
      WHERE status = 'pending' AND printer = v_printer
        AND (id = v_job.id OR (v_job.batch_id IS NOT NULL AND batch_id = v_job.batch_id))
      RETURNING *;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.complete_print_job(p_id uuid, p_device text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.print_rpc', 'on', true);
  UPDATE public.print_jobs SET status = 'printed', printed_at = now(), error = NULL, last_error = NULL, lease_until = NULL
  WHERE id = p_id AND status = 'pending';
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.fail_print_job(p_id uuid, p_device text, p_error text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_next timestamptz;
BEGIN
  PERFORM set_config('app.print_rpc', 'on', true);
  UPDATE public.print_jobs SET attempts = attempts + 1, last_error = left(p_error, 500), error = left(p_error, 500),
    lease_until = NULL,
    next_attempt_at = now() + make_interval(secs => least(300, power(2, least(attempts + 1, 9))))
  WHERE id = p_id AND status = 'pending'
  RETURNING next_attempt_at INTO v_next;
  RETURN v_next;
END $$;

-- Atomic, idempotent shift open with its OPENING tickets in the same transaction.
CREATE OR REPLACE FUNCTION public.open_shift_safely(
  p_opened_by uuid, p_opening_float numeric, p_business_day date, p_print_jobs jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_shift public.shifts; v_job jsonb; v_n integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('shift:open', 0));
  SELECT * INTO v_shift FROM public.shifts WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('created', false, 'shift', to_jsonb(v_shift));
  END IF;
  BEGIN
    INSERT INTO public.shifts(business_day, opened_by, opening_float)
    VALUES (p_business_day, p_opened_by, coalesce(p_opening_float, 0)) RETURNING * INTO v_shift;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_shift FROM public.shifts WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1;
    RETURN jsonb_build_object('created', false, 'shift', to_jsonb(v_shift));
  END;
  FOR v_job IN SELECT * FROM jsonb_array_elements(coalesce(p_print_jobs, '[]'::jsonb)) LOOP
    v_n := v_n + 1;
    PERFORM public.enqueue_print_job('opening:' || v_shift.id || ':' || (v_job->>'printer') || ':' || v_n,
      (v_job->>'printer')::public.printer_kind, v_job->'payload', 'opening', v_shift.id, NULL);
  END LOOP;
  RETURN jsonb_build_object('created', true, 'shift', to_jsonb(v_shift));
END $$;

-- Z close with its Z ticket in the same transaction. Repeat calls adopt the
-- committed close. Old 4-arg close_shift_safely is left untouched for cached clients.
CREATE OR REPLACE FUNCTION public.close_shift_with_ticket(
  p_shift_id uuid, p_closed_by uuid, p_cash_count jsonb, p_totals jsonb, p_print_payload jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_shift public.shifts; v_blockers jsonb;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift not found'; END IF;
  IF v_shift.status <> 'open' THEN
    RETURN jsonb_build_object('closed', true, 'adopted', true, 'shift', to_jsonb(v_shift));
  END IF;
  v_blockers := public.get_shift_close_blockers(p_shift_id);
  IF coalesce((v_blockers ->> 'has_blockers')::boolean, false) THEN
    RETURN jsonb_build_object('closed', false, 'reason', 'blocked', 'blockers', v_blockers);
  END IF;
  UPDATE public.shifts SET closed_at = now(), closed_by = p_closed_by, status = 'closed',
    cash_count = p_cash_count, totals = p_totals WHERE id = p_shift_id RETURNING * INTO v_shift;
  IF p_print_payload IS NOT NULL THEN
    PERFORM public.enqueue_print_job('z:' || p_shift_id, 'counter', p_print_payload, 'z', p_shift_id, NULL);
  END IF;
  RETURN jsonb_build_object('closed', true, 'adopted', false, 'shift', to_jsonb(v_shift));
END $$;

-- Audit trail for automatic, safe self-healing.
CREATE TABLE IF NOT EXISTS public.integrity_heal_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  entity_id uuid,
  before jsonb,
  after jsonb,
  healed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.integrity_heal_audit TO authenticated;
GRANT ALL ON public.integrity_heal_audit TO service_role;
ALTER TABLE public.integrity_heal_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrity_heal_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read heal audit" ON public.integrity_heal_audit FOR SELECT TO authenticated USING (true);

-- Safe projection heal only: table status/guests recomputed from open orders.
CREATE OR REPLACE FUNCTION public.heal_table_projection()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_n integer := 0; v_after public.restaurant_tables;
BEGIN
  FOR r IN
    SELECT t.* FROM public.restaurant_tables t
    LEFT JOIN public.orders o ON o.table_id = t.id AND o.status = 'open'
    WHERE (o.id IS NULL AND (t.status <> 'available' OR t.guests <> 0))
       OR (o.id IS NOT NULL AND (t.status = 'available' OR t.guests <> greatest(1, o.guests)))
    FOR UPDATE OF t
  LOOP
    UPDATE public.restaurant_tables SET status = r.status, guests = r.guests WHERE id = r.id RETURNING * INTO v_after;
    INSERT INTO public.integrity_heal_audit(kind, entity_id, before, after)
    VALUES ('table_projection', r.id, to_jsonb(r), to_jsonb(v_after));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- Read-only authoritative integrity status for owner diagnostics.
CREATE OR REPLACE FUNCTION public.get_integrity_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'checked_at', now(),
    'open_shifts', (SELECT count(*) FROM shifts WHERE status = 'open'),
    'table_projection_mismatches', (
      SELECT count(*) FROM restaurant_tables t
      LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'open'
      WHERE (o.id IS NULL AND t.status <> 'available') OR (o.id IS NOT NULL AND t.status = 'available')),
    'duplicate_open_orders_per_table', (
      SELECT count(*) FROM (SELECT table_id FROM orders WHERE status = 'open' AND table_id IS NOT NULL GROUP BY table_id HAVING count(*) > 1) d),
    'duplicate_bills_per_order', (
      SELECT count(*) FROM (SELECT order_id FROM bills GROUP BY order_id HAVING count(*) > 1) d),
    'open_orders_without_shift', (SELECT count(*) FROM orders WHERE status = 'open' AND shift_id IS NULL),
    'orphan_open_bills_inert', (
      SELECT count(*) FROM bills b JOIN orders o ON o.id = b.order_id
      WHERE b.status = 'open' AND o.status <> 'open'
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.bill_id = b.id)
        AND NOT EXISTS (SELECT 1 FROM bill_discounts d WHERE d.bill_id = b.id)
        AND coalesce(b.points_redeemed, 0) = 0),
    'orphan_open_bills_with_money', (
      SELECT count(*) FROM bills b JOIN orders o ON o.id = b.order_id
      WHERE b.status = 'open' AND o.status <> 'open'
        AND (EXISTS (SELECT 1 FROM payments p WHERE p.bill_id = b.id)
          OR EXISTS (SELECT 1 FROM bill_discounts d WHERE d.bill_id = b.id)
          OR coalesce(b.points_redeemed, 0) > 0)),
    'print_pending', (SELECT count(*) FROM print_jobs WHERE status = 'pending'),
    'print_pending_oldest_seconds', (SELECT extract(epoch FROM now() - min(created_at))::int FROM print_jobs WHERE status = 'pending'),
    'print_pending_max_attempts', (SELECT coalesce(max(attempts), 0) FROM print_jobs WHERE status = 'pending'),
    'print_failed_legacy', (SELECT count(*) FROM print_jobs WHERE status = 'failed'),
    'last_heal_at', (SELECT max(healed_at) FROM integrity_heal_audit)
  );
$$;

REVOKE ALL ON FUNCTION public.print_jobs_keep_outbox_retrying() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_print_job(text, public.printer_kind, jsonb, text, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_print_jobs(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_print_job(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fail_print_job(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.open_shift_safely(uuid, numeric, date, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_shift_with_ticket(uuid, uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.heal_table_projection() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_integrity_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_print_job(text, public.printer_kind, jsonb, text, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_print_jobs(text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_print_job(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fail_print_job(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.open_shift_safely(uuid, numeric, date, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_shift_with_ticket(uuid, uuid, jsonb, jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.heal_table_projection() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_integrity_status() TO authenticated, service_role;
