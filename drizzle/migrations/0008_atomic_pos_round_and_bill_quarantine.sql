-- Atomic, idempotent POS Send Round: one stable submission id, the exact unsent
-- item ids, and the prepared tickets are committed together under an order lock.
CREATE OR REPLACE FUNCTION public.submit_pos_round_safely(
  p_submission_id uuid,
  p_order_id uuid,
  p_item_ids uuid[],
  p_print_jobs jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE(created boolean, round_number integer, item_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders;
  v_existing public.order_submissions;
  v_ids uuid[];
  v_round integer;
  v_count integer;
  v_batch uuid;
  v_job jsonb;
  v_n integer;
  v_sent_at timestamptz := now();
BEGIN
  IF p_submission_id IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'Submission id and order id are required';
  END IF;
  IF p_print_jobs IS NULL OR jsonb_typeof(p_print_jobs) <> 'array' THEN
    RAISE EXCEPTION 'Print jobs must be an array';
  END IF;

  -- Serialize every send for this order (also serializes same-id retries).
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  SELECT * INTO v_existing FROM public.order_submissions WHERE id = p_submission_id;
  IF FOUND THEN
    IF v_existing.order_id IS DISTINCT FROM p_order_id THEN
      RAISE EXCEPTION 'Submission id belongs to another order';
    END IF;
    RETURN QUERY SELECT false, v_existing.round_number, v_existing.item_count;
    RETURN;
  END IF;

  IF v_order.status <> 'open' THEN RAISE EXCEPTION 'Order is not open'; END IF;

  SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(coalesce(p_item_ids, '{}'::uuid[])) AS x WHERE x IS NOT NULL;
  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'At least one unsent item is required';
  END IF;

  SELECT count(*) INTO v_count FROM public.order_items
  WHERE id = ANY(v_ids) AND order_id = p_order_id AND status = 'pending'
  FOR UPDATE;
  IF v_count <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'Order items changed or were already sent; refresh and try again';
  END IF;

  v_round := public.allocate_order_round(p_order_id);

  UPDATE public.order_items
  SET status = 'sent', sent_at = v_sent_at, round_number = v_round, round_source = 'pos'
  WHERE id = ANY(v_ids) AND order_id = p_order_id AND status = 'pending';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.order_submissions(id, order_id, round_number, item_count)
  VALUES (p_submission_id, p_order_id, v_round, v_count);

  v_batch := gen_random_uuid();
  FOR v_job, v_n IN SELECT j, o::int FROM jsonb_array_elements(p_print_jobs) WITH ORDINALITY AS t(j, o) LOOP
    PERFORM public.enqueue_print_job(
      'round:' || p_submission_id || ':' || (v_job->>'printer') || ':' || v_n,
      (v_job->>'printer')::public.printer_kind,
      coalesce(v_job->'payload', '{}'::jsonb)
        || jsonb_build_object('round_number', v_round, 'sent_at', v_sent_at),
      'round', p_order_id,
      CASE WHEN coalesce((v_job->>'batch')::boolean, false) THEN v_batch END
    );
  END LOOP;

  RETURN QUERY SELECT true, v_round, v_count;
END $$;

REVOKE ALL ON FUNCTION public.submit_pos_round_safely(uuid, uuid, uuid[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_pos_round_safely(uuid, uuid, uuid[], jsonb) TO authenticated, service_role;

-- Quarantine marker for provably inert orphan bills (never deletes).
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS quarantined_at timestamptz;

CREATE TABLE IF NOT EXISTS public.bill_quarantine_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL UNIQUE,
  order_id uuid NOT NULL,
  bill_snapshot jsonb NOT NULL,
  reason text NOT NULL,
  quarantined_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bill_quarantine_audit TO service_role;
ALTER TABLE public.bill_quarantine_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_quarantine_audit FORCE ROW LEVEL SECURITY;

-- True only when a bill has no financial activity of any kind.
CREATE OR REPLACE FUNCTION public.bill_is_financially_inert(p_bill_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM bills b WHERE b.id = p_bill_id
      AND b.status = 'open'
      AND b.paid_at IS NULL
      AND b.member_id IS NULL
      AND coalesce(b.points_redeemed, 0) = 0
      AND coalesce(b.loyalty_discount_amount, 0) = 0
      AND b.loyalty_reserved_at IS NULL
      AND coalesce(b.discount_amount, 0) = 0
      AND coalesce(b.member_discount_amount, 0) = 0)
    AND NOT EXISTS (SELECT 1 FROM payments WHERE bill_id = p_bill_id)
    AND NOT EXISTS (SELECT 1 FROM bill_discounts WHERE bill_id = p_bill_id)
    AND NOT EXISTS (SELECT 1 FROM order_item_discounts WHERE bill_id = p_bill_id)
    AND NOT EXISTS (SELECT 1 FROM refunds WHERE bill_id = p_bill_id)
    AND NOT EXISTS (SELECT 1 FROM member_point_ledger WHERE bill_id = p_bill_id)
    AND NOT EXISTS (SELECT 1 FROM loyalty_claim_tokens WHERE bill_id = p_bill_id);
$$;
REVOKE ALL ON FUNCTION public.bill_is_financially_inert(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bill_is_financially_inert(uuid) TO authenticated, service_role;

-- Prepared, NOT executed: audited quarantine of one provably inert orphan bill.
CREATE OR REPLACE FUNCTION public.quarantine_inert_orphan_bill(p_bill_id uuid, p_reason text DEFAULT 'inert orphan open bill on closed order')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bill public.bills; v_order_status public.order_status;
BEGIN
  SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF v_bill.quarantined_at IS NOT NULL THEN RETURN false; END IF;
  SELECT status INTO v_order_status FROM public.orders WHERE id = v_bill.order_id FOR UPDATE;
  IF v_order_status = 'open' THEN RAISE EXCEPTION 'Order is still open; bill is not orphaned'; END IF;
  IF NOT public.bill_is_financially_inert(p_bill_id) THEN
    RAISE EXCEPTION 'Bill has financial activity; owner accounting decision required';
  END IF;
  INSERT INTO public.bill_quarantine_audit(bill_id, order_id, bill_snapshot, reason)
  VALUES (v_bill.id, v_bill.order_id, to_jsonb(v_bill), p_reason);
  UPDATE public.bills SET quarantined_at = now() WHERE id = p_bill_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.quarantine_inert_orphan_bill(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quarantine_inert_orphan_bill(uuid, text) TO service_role;

-- Integrity status: same keys as before, orphan bills reported distinctly.
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
      WHERE b.status = 'open' AND o.status <> 'open' AND b.quarantined_at IS NULL
        AND public.bill_is_financially_inert(b.id)),
    'orphan_open_bills_inert_ids', (
      SELECT coalesce(jsonb_agg(b.id ORDER BY b.created_at), '[]'::jsonb) FROM bills b JOIN orders o ON o.id = b.order_id
      WHERE b.status = 'open' AND o.status <> 'open' AND b.quarantined_at IS NULL
        AND public.bill_is_financially_inert(b.id)),
    'orphan_open_bills_with_money', (
      SELECT count(*) FROM bills b JOIN orders o ON o.id = b.order_id
      WHERE b.status = 'open' AND o.status <> 'open' AND b.quarantined_at IS NULL
        AND NOT public.bill_is_financially_inert(b.id)),
    'orphan_open_bills_quarantined', (SELECT count(*) FROM bills WHERE quarantined_at IS NOT NULL),
    'print_pending', (SELECT count(*) FROM print_jobs WHERE status = 'pending'),
    'print_pending_oldest_seconds', (SELECT extract(epoch FROM now() - min(created_at))::int FROM print_jobs WHERE status = 'pending'),
    'print_pending_max_attempts', (SELECT coalesce(max(attempts), 0) FROM print_jobs WHERE status = 'pending'),
    'print_failed_legacy', (SELECT count(*) FROM print_jobs WHERE status = 'failed'),
    'last_heal_at', (SELECT max(healed_at) FROM integrity_heal_audit)
  );
$$;
REVOKE ALL ON FUNCTION public.get_integrity_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_integrity_status() TO authenticated, service_role;