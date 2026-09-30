-- Table service is one continuous order from seating through payment.
-- Enforce that invariant in the database so stale devices and concurrent
-- POS/QR requests cannot split one table across multiple open orders.

DO $$
DECLARE
  v_duplicates jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'table_id', duplicate.table_id,
    'order_ids', duplicate.order_ids
  ))
  INTO v_duplicates
  FROM (
    SELECT table_id, array_agg(id ORDER BY opened_at) AS order_ids
    FROM public.orders
    WHERE status = 'open' AND table_id IS NOT NULL
    GROUP BY table_id
    HAVING count(*) > 1
  ) duplicate;

  IF v_duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot enforce one open order per table; repair duplicates first'
      USING DETAIL = v_duplicates::text;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS orders_one_open_order_per_table_idx
  ON public.orders(table_id)
  WHERE status = 'open' AND table_id IS NOT NULL;

-- Keep an immutable trail of table moves. This makes incidents such as a
-- T16 -> T15 move explainable without changing or deleting the order history.
CREATE TABLE IF NOT EXISTS public.order_table_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  source_table_id uuid NOT NULL REFERENCES public.restaurant_tables(id),
  target_table_id uuid NOT NULL REFERENCES public.restaurant_tables(id),
  moved_by uuid REFERENCES public.staff(id),
  moved_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_table_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_table_moves FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can read table moves" ON public.order_table_moves;
CREATE POLICY "authenticated can read table moves"
  ON public.order_table_moves FOR SELECT TO authenticated USING (true);

REVOKE ALL ON TABLE public.order_table_moves FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.order_table_moves TO authenticated;
GRANT ALL ON TABLE public.order_table_moves TO service_role;

-- A browser may retry the same QR submission after a timeout even though the
-- first request committed. Keep one durable idempotency key per cart submit so
-- items and all print jobs are committed together, exactly once.
CREATE TABLE IF NOT EXISTS public.order_submissions (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id),
  round_number integer,
  item_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_submissions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_submissions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.order_submissions TO service_role;

-- Keep the normal POS/QR entry point idempotent even when an older device that
-- does not take the advisory lock inserts at exactly the same time. The unique
-- index is the final authority; a losing current client adopts the winner.
CREATE OR REPLACE FUNCTION public.open_table_order_safely(
  p_table_id uuid,
  p_shift_id uuid,
  p_guests integer,
  p_opened_by uuid DEFAULT NULL,
  p_source public.order_source DEFAULT 'pos',
  p_is_test boolean DEFAULT false
)
RETURNS TABLE(order_id uuid, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_shift_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_table_id::text, 0));

  SELECT o.id INTO v_order_id
  FROM public.orders o
  WHERE o.table_id = p_table_id AND o.status = 'open'
  ORDER BY o.opened_at DESC
  LIMIT 1;

  IF v_order_id IS NOT NULL THEN
    order_id := v_order_id;
    created := false;
    RETURN NEXT;
    RETURN;
  END IF;

  v_shift_id := p_shift_id;
  IF v_shift_id IS NULL THEN
    SELECT s.id INTO v_shift_id
    FROM public.shifts s
    WHERE s.status = 'open'
    ORDER BY s.opened_at DESC
    LIMIT 1;
  END IF;
  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'No open shift';
  END IF;

  BEGIN
    INSERT INTO public.orders(table_id, shift_id, guests, opened_by, source, is_test)
    VALUES (
      p_table_id, v_shift_id, greatest(1, coalesce(p_guests, 1)),
      p_opened_by, p_source, coalesce(p_is_test, false)
    )
    RETURNING id INTO v_order_id;
    created := true;
  EXCEPTION WHEN unique_violation THEN
    SELECT o.id INTO v_order_id
    FROM public.orders o
    WHERE o.table_id = p_table_id AND o.status = 'open'
    ORDER BY o.opened_at DESC
    LIMIT 1;
    IF v_order_id IS NULL THEN
      RAISE;
    END IF;
    created := false;
  END;

  order_id := v_order_id;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_table_state_from_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_table_id uuid;
  v_new_table_id uuid;
BEGIN
  v_old_table_id := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.table_id ELSE NULL END;
  v_new_table_id := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.table_id ELSE NULL END;

  -- Release the former table only when no open order still owns it. This runs
  -- inside the same transaction as a move/close, so the UI cannot observe a
  -- half-moved order.
  IF v_old_table_id IS NOT NULL
     AND (TG_OP = 'DELETE'
          OR v_old_table_id IS DISTINCT FROM v_new_table_id
          OR (OLD.status = 'open' AND NEW.status <> 'open')) THEN
    UPDATE public.restaurant_tables t
    SET status = 'available', guests = 0, has_qr_alert = false
    WHERE t.id = v_old_table_id
      AND NOT EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.table_id = t.id AND o.status = 'open'
      );
  END IF;

  IF v_new_table_id IS NOT NULL AND NEW.status = 'open' THEN
    UPDATE public.restaurant_tables
    SET status = CASE
          WHEN status = 'bill_requested' THEN 'bill_requested'::public.table_status
          ELSE 'occupied'::public.table_status
        END,
        guests = greatest(1, coalesce(NEW.guests, 1))
    WHERE id = v_new_table_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_table_state_from_order ON public.orders;
CREATE TRIGGER sync_table_state_from_order
AFTER INSERT OR DELETE OR UPDATE OF table_id, status, guests ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.sync_table_state_from_order();

CREATE OR REPLACE FUNCTION public.require_open_order_for_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.order_status;
BEGIN
  SELECT status INTO v_status
  FROM public.orders
  WHERE id = NEW.order_id
  FOR SHARE;

  IF v_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'Cannot add items to a closed order';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS require_open_order_for_item ON public.order_items;
CREATE TRIGGER require_open_order_for_item
BEFORE INSERT OR UPDATE OF order_id ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.require_open_order_for_item();

CREATE OR REPLACE FUNCTION public.submit_order_round_safely(
  p_submission_id uuid,
  p_order_id uuid,
  p_items jsonb,
  p_print_jobs jsonb
)
RETURNS TABLE(created boolean, round_number integer, item_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_round integer;
  v_item_count integer := 0;
  v_existing public.order_submissions%ROWTYPE;
BEGIN
  IF p_submission_id IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'Submission id and order id are required';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one order item is required';
  END IF;
  IF p_print_jobs IS NULL OR jsonb_typeof(p_print_jobs) <> 'array' THEN
    RAISE EXCEPTION 'Print jobs must be an array';
  END IF;

  INSERT INTO public.order_submissions(id, order_id)
  VALUES (p_submission_id, p_order_id)
  ON CONFLICT (id) DO NOTHING;

  IF NOT FOUND THEN
    SELECT * INTO v_existing
    FROM public.order_submissions
    WHERE id = p_submission_id;
    IF v_existing.order_id IS DISTINCT FROM p_order_id THEN
      RAISE EXCEPTION 'Submission id belongs to another order';
    END IF;
    RETURN QUERY SELECT false, v_existing.round_number, v_existing.item_count;
    RETURN;
  END IF;

  v_round := public.allocate_order_round(p_order_id);

  INSERT INTO public.order_items (
    order_id, menu_id, name_th, name_en, name_my, qty, unit_price,
    unit_cost, notes, modifiers, status, sent_at, round_number,
    round_source, set_config
  )
  SELECT
    p_order_id, item.menu_id, item.name_th, item.name_en, item.name_my,
    item.qty, item.unit_price, item.unit_cost, item.notes, item.modifiers,
    'sent'::public.order_item_status, item.sent_at, v_round,
    item.round_source, item.set_config
  FROM jsonb_to_recordset(p_items) AS item(
    menu_id uuid,
    name_th text,
    name_en text,
    name_my text,
    qty integer,
    unit_price numeric,
    unit_cost numeric,
    notes text,
    modifiers jsonb,
    sent_at timestamptz,
    round_source text,
    set_config jsonb
  );
  GET DIAGNOSTICS v_item_count = ROW_COUNT;

  INSERT INTO public.print_jobs(printer, payload)
  SELECT
    job.printer::public.printer_kind,
    job.payload || jsonb_build_object('round_number', v_round)
  FROM jsonb_to_recordset(p_print_jobs) AS job(printer text, payload jsonb);

  UPDATE public.order_submissions
  SET round_number = v_round, item_count = v_item_count
  WHERE id = p_submission_id;

  RETURN QUERY SELECT true, v_round, v_item_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.move_table_order_safely(
  p_order_id uuid,
  p_target_table_id uuid,
  p_moved_by uuid DEFAULT NULL
)
RETURNS TABLE(order_id uuid, source_table_code text, target_table_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_source_code text;
  v_target_code text;
  v_target_status public.table_status;
  v_lock_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL OR v_order.status <> 'open' OR v_order.table_id IS NULL THEN
    RAISE EXCEPTION 'Open table order not found';
  END IF;
  IF p_target_table_id IS NULL THEN
    RAISE EXCEPTION 'Target table is required';
  END IF;
  IF p_target_table_id = v_order.table_id THEN
    SELECT code INTO v_source_code FROM public.restaurant_tables WHERE id = v_order.table_id;
    RETURN QUERY SELECT v_order.id, v_source_code, v_source_code;
    RETURN;
  END IF;

  -- Use the same advisory lock as open_table_order_safely for both tables.
  FOR v_lock_id IN
    SELECT id FROM (VALUES (v_order.table_id), (p_target_table_id)) AS locks(id)
    ORDER BY id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_id::text, 0));
  END LOOP;

  SELECT code INTO v_source_code
  FROM public.restaurant_tables
  WHERE id = v_order.table_id
  FOR UPDATE;
  SELECT code, status INTO v_target_code, v_target_status
  FROM public.restaurant_tables
  WHERE id = p_target_table_id
  FOR UPDATE;

  IF v_source_code IS NULL OR v_target_code IS NULL THEN
    RAISE EXCEPTION 'Source or target table not found';
  END IF;
  IF v_target_status <> 'available' THEN
    RAISE EXCEPTION 'Target table is not available';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE table_id = p_target_table_id AND status = 'open' AND id <> p_order_id
  ) THEN
    RAISE EXCEPTION 'Target table already has an open order';
  END IF;

  UPDATE public.orders
  SET table_id = p_target_table_id
  WHERE id = p_order_id AND status = 'open';

  INSERT INTO public.order_table_moves
    (order_id, source_table_id, target_table_id, moved_by)
  VALUES
    (v_order.id, v_order.table_id, p_target_table_id, p_moved_by);

  -- The order id never changes. Every QR that is bound to this order follows
  -- it to the new table automatically.
  RETURN QUERY SELECT v_order.id, v_source_code, v_target_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_table_order_safely(
  p_order_id uuid,
  p_reason text,
  p_closed_by uuid DEFAULT NULL
)
RETURNS TABLE(order_id uuid, table_code text, voided_items integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_table_code text;
  v_reason text := nullif(btrim(p_reason), '');
  v_voided integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Close reason is required';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL OR v_order.status <> 'open' THEN
    RAISE EXCEPTION 'Open order not found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bills b
    WHERE b.order_id = p_order_id
      AND (
        b.status <> 'open'
        OR b.member_id IS NOT NULL
        OR coalesce(b.points_redeemed, 0) <> 0
        OR coalesce(b.loyalty_discount_amount, 0) <> 0
        OR coalesce(b.discount_amount, 0) <> 0
        OR EXISTS (SELECT 1 FROM public.payments p WHERE p.bill_id = b.id)
        OR EXISTS (SELECT 1 FROM public.bill_discounts d WHERE d.bill_id = b.id)
      )
  ) THEN
    RAISE EXCEPTION 'Cannot close after payment, member points, or discounts have started';
  END IF;

  -- An untouched draft bill can be rebuilt later; it must not survive a
  -- cancelled table and block Z close.
  DELETE FROM public.bills b WHERE b.order_id = p_order_id;

  INSERT INTO public.voids(order_item_id, reason, voided_by, amount, shift_id)
  SELECT oi.id, v_reason, p_closed_by, oi.qty * oi.unit_price, v_order.shift_id
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id AND oi.status <> 'voided'
    AND NOT EXISTS (SELECT 1 FROM public.voids v WHERE v.order_item_id = oi.id);

  UPDATE public.order_items oi
  SET status = 'voided', void_reason = v_reason,
      voided_by = p_closed_by, voided_at = now()
  WHERE oi.order_id = p_order_id AND oi.status <> 'voided';
  GET DIAGNOSTICS v_voided = ROW_COUNT;

  SELECT code INTO v_table_code
  FROM public.restaurant_tables
  WHERE id = v_order.table_id;

  UPDATE public.orders
  SET status = 'cancelled', closed_at = now(), closed_by = p_closed_by,
      cancel_reason = v_reason, checkout_requested_at = NULL
  WHERE id = p_order_id;

  RETURN QUERY SELECT v_order.id, v_table_code, v_voided;
END;
$$;

REVOKE ALL ON FUNCTION public.move_table_order_safely(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_table_order_safely(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.open_table_order_safely(uuid, uuid, integer, uuid, public.order_source, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_order_round_safely(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_table_order_safely(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_table_order_safely(uuid, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.open_table_order_safely(uuid, uuid, integer, uuid, public.order_source, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_order_round_safely(uuid, uuid, jsonb, jsonb) TO service_role;
