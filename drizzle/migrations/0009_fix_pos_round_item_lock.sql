-- Row locks cannot be combined with count(); lock items first, then count.
CREATE OR REPLACE FUNCTION public.submit_pos_round_safely(
  p_submission_id uuid,
  p_order_id uuid,
  p_item_ids uuid[],
  p_print_jobs jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE(created boolean, round_number integer, item_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
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

  PERFORM 1 FROM public.order_items WHERE id = ANY(v_ids) FOR UPDATE;
  SELECT count(*) INTO v_count FROM public.order_items
  WHERE id = ANY(v_ids) AND order_id = p_order_id AND status = 'pending';
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