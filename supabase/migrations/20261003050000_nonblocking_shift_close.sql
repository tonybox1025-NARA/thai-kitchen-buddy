-- Closing is an operational boundary, not a debt-collection workflow.
-- A cashier must always be able to finish Z close.  Any inconsistent state is
-- preserved for manager review while the next shift starts cleanly.

CREATE TABLE IF NOT EXISTS public.shift_close_review_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id),
  business_day date NOT NULL,
  bill_id uuid REFERENCES public.bills(id),
  order_id uuid REFERENCES public.orders(id),
  table_id uuid REFERENCES public.restaurant_tables(id),
  kind text NOT NULL CHECK (kind IN (
    'paid_state_not_finalized',
    'payment_record_mismatch',
    'order_not_finalized',
    'table_state_not_released',
    'loyalty_state_mismatch'
  )),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'auto_resolved', 'reviewed')),
  expected_amount numeric(12,2),
  recorded_amount numeric(12,2),
  payment_methods jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.staff(id),
  resolution text,
  manager_note text
);

CREATE UNIQUE INDEX IF NOT EXISTS shift_close_review_bill_kind_uidx
  ON public.shift_close_review_items(shift_id, bill_id, kind)
  WHERE bill_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS shift_close_review_order_kind_uidx
  ON public.shift_close_review_items(shift_id, order_id, kind)
  WHERE bill_id IS NULL AND order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS shift_close_review_table_kind_uidx
  ON public.shift_close_review_items(shift_id, table_id, kind)
  WHERE bill_id IS NULL AND order_id IS NULL AND table_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS shift_close_review_pending_idx
  ON public.shift_close_review_items(status, business_day DESC);

ALTER TABLE public.shift_close_review_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shift_close_review_items FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.shift_close_review_items TO authenticated;
GRANT ALL ON TABLE public.shift_close_review_items TO service_role;

DROP POLICY IF EXISTS "authenticated read shift close reviews" ON public.shift_close_review_items;
CREATE POLICY "authenticated read shift close reviews"
  ON public.shift_close_review_items FOR SELECT TO authenticated USING (true);

-- Finish a fully collected bill at the database boundary.  This is invoked by
-- the payment trigger, so a device/network interruption can no longer leave a
-- payment saved while the Bill remains open.
CREATE OR REPLACE FUNCTION public.finalize_collected_bill_from_state(p_bill_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill public.bills%ROWTYPE;
  v_paid numeric := 0;
  v_loyalty_enabled boolean := false;
  v_points_per_baht numeric := 1;
  v_earn integer := 0;
BEGIN
  SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_bill.status = 'paid' THEN RETURN true; END IF;
  IF v_bill.status <> 'open' THEN RETURN false; END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_paid FROM public.payments WHERE bill_id = p_bill_id;
  IF v_paid + 0.001 < v_bill.total THEN RETURN false; END IF;

  IF v_bill.member_id IS NOT NULL AND NOT COALESCE(v_bill.is_test, false) THEN
    SELECT loyalty_enabled, loyalty_points_per_baht
      INTO v_loyalty_enabled, v_points_per_baht
    FROM public.settings WHERE id = 1;
    IF COALESCE(v_loyalty_enabled, false) THEN
      v_earn := GREATEST(0, FLOOR(GREATEST(0,
        v_bill.subtotal - v_bill.discount_amount - v_bill.member_discount_amount
        - v_bill.loyalty_discount_amount
      ) * COALESCE(v_points_per_baht, 1)))::integer;
    END IF;
    PERFORM * FROM public.process_bill_loyalty(
      v_bill.id, v_bill.member_id, COALESCE(v_bill.points_redeemed, 0), v_earn
    );
  END IF;

  UPDATE public.bills
  SET status = 'paid',
      paid_at = COALESCE(paid_at, (SELECT max(created_at) FROM public.payments WHERE bill_id = p_bill_id), now())
  WHERE id = p_bill_id;

  UPDATE public.orders
  SET status = 'closed', closed_at = COALESCE(closed_at, now())
  WHERE id = v_bill.order_id;

  UPDATE public.restaurant_tables t
  SET status = 'available', guests = 0, has_qr_alert = false
  FROM public.orders o
  WHERE o.id = v_bill.order_id AND t.id = o.table_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_bill_after_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.finalize_collected_bill_from_state(NEW.bill_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finalize_bill_after_payment ON public.payments;
CREATE TRIGGER finalize_bill_after_payment
AFTER INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.finalize_bill_after_payment();

-- The payment trigger may finish the Bill before the client sends the selected
-- member.  Retrying finalize must still complete loyalty, idempotently.
CREATE OR REPLACE FUNCTION public.finalize_bill_payment(
  p_bill_id uuid,
  p_member_id uuid DEFAULT NULL,
  p_redeem_points integer DEFAULT 0,
  p_earn_points integer DEFAULT 0,
  p_cashier_id uuid DEFAULT NULL
)
RETURNS TABLE(bill_status public.bill_status, balance_after integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill public.bills%ROWTYPE;
  v_paid numeric := 0;
  v_balance integer := NULL;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF COALESCE(p_redeem_points, 0) < 0 OR COALESCE(p_earn_points, 0) < 0 THEN
    RAISE EXCEPTION 'Point amounts must not be negative';
  END IF;

  SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF v_bill.status NOT IN ('open', 'paid') THEN
    RAISE EXCEPTION 'Bill cannot be finalized from status %', v_bill.status;
  END IF;

  IF p_member_id IS NOT NULL THEN
    SELECT result.balance_after INTO v_balance
    FROM public.process_bill_loyalty(
      p_bill_id, p_member_id, COALESCE(p_redeem_points, 0), COALESCE(p_earn_points, 0)
    ) AS result;
  ELSIF COALESCE(p_redeem_points, 0) > 0 OR COALESCE(p_earn_points, 0) > 0 THEN
    RAISE EXCEPTION 'Member is required when processing points';
  ELSIF v_bill.member_id IS NOT NULL THEN
    SELECT current_points INTO v_balance FROM public.members WHERE id = v_bill.member_id;
  END IF;

  IF v_bill.status = 'open' THEN
    SELECT COALESCE(sum(amount), 0) INTO v_paid FROM public.payments WHERE bill_id = p_bill_id;
    IF v_paid + 0.001 < v_bill.total THEN RAISE EXCEPTION 'Bill is not fully paid'; END IF;
    PERFORM public.finalize_collected_bill_from_state(p_bill_id);
  END IF;

  UPDATE public.bills SET cashier_id = COALESCE(p_cashier_id, cashier_id) WHERE id = p_bill_id;
  RETURN QUERY SELECT 'paid'::public.bill_status, v_balance;
END;
$$;

-- Preserve every unusual close-time state, then clear only its operational
-- projection.  Original orders, bills and payments are retained for audit.
CREATE OR REPLACE FUNCTION public.prepare_shift_for_nonblocking_close(p_shift_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_bill record;
  v_order record;
  v_table record;
  v_kind text;
  v_status text;
  v_review_count integer := 0;
  v_auto_count integer := 0;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift not found'; END IF;

  FOR v_bill IN
    SELECT b.*, COALESCE(p.paid, 0) paid,
      COALESCE(p.methods, '[]'::jsonb) methods,
      o.table_id, o.status order_status, o.source order_source,
      EXISTS (SELECT 1 FROM public.staff_tab_charges stc WHERE stc.order_id = o.id) staff_tab_recorded
    FROM public.bills b
    JOIN public.orders o ON o.id = b.order_id
    LEFT JOIN LATERAL (
      SELECT sum(x.amount) paid,
        jsonb_agg(jsonb_build_object('method', x.method, 'amount', x.amount) ORDER BY x.created_at) methods
      FROM public.payments x WHERE x.bill_id = b.id
    ) p ON true
    WHERE b.shift_id = p_shift_id AND b.status = 'open' AND NOT COALESCE(b.is_test, false)
    FOR UPDATE OF b
  LOOP
    -- Staff credit is settled operationally when it is transferred to the
    -- staff tab. It is not a missing customer payment and must never appear as
    -- a closing exception or be counted again as a paid Bill.
    IF v_bill.order_source = 'staff_meal' AND v_bill.staff_tab_recorded THEN
      UPDATE public.bills SET quarantined_at = COALESCE(quarantined_at, now()) WHERE id = v_bill.id;
      v_auto_count := v_auto_count + 1;
      CONTINUE;
    END IF;

    IF v_bill.paid + 0.001 >= v_bill.total THEN
      v_kind := 'paid_state_not_finalized';
      v_status := 'auto_resolved';
      v_auto_count := v_auto_count + 1;
    ELSE
      v_kind := 'payment_record_mismatch';
      v_status := 'pending';
      v_review_count := v_review_count + 1;
    END IF;

    INSERT INTO public.shift_close_review_items(
      shift_id, business_day, bill_id, order_id, table_id, kind, status,
      expected_amount, recorded_amount, payment_methods, snapshot,
      resolved_at, resolution
    ) VALUES (
      p_shift_id, v_shift.business_day, v_bill.id, v_bill.order_id, v_bill.table_id,
      v_kind, v_status, v_bill.total, v_bill.paid, v_bill.methods,
      jsonb_build_object(
        'bill_status', v_bill.status, 'order_status', v_bill.order_status,
        'subtotal', v_bill.subtotal, 'discount_amount', v_bill.discount_amount,
        'member_discount_amount', v_bill.member_discount_amount,
        'loyalty_discount_amount', v_bill.loyalty_discount_amount
      ),
      CASE WHEN v_status = 'auto_resolved' THEN now() ELSE NULL END,
      CASE WHEN v_status = 'auto_resolved' THEN 'Payment existed; finalized automatically at Z close' ELSE NULL END
    ) ON CONFLICT DO NOTHING;

    IF v_status = 'auto_resolved' THEN
      PERFORM public.finalize_collected_bill_from_state(v_bill.id);
    ELSE
      -- The restaurant's operational rule is that checkout was completed on
      -- site. Keep the tender mismatch for review, but do not carry an open
      -- Bill forward.
      UPDATE public.bills
      SET status = 'paid',
          paid_at = COALESCE(paid_at,
            (SELECT max(created_at) FROM public.payments WHERE bill_id = v_bill.id), now())
      WHERE id = v_bill.id;
      UPDATE public.orders
      SET status = 'closed', closed_at = COALESCE(closed_at, now())
      WHERE id = v_bill.order_id;
    END IF;
  END LOOP;

  FOR v_order IN
    SELECT o.*, t.code table_code
    FROM public.orders o
    LEFT JOIN public.restaurant_tables t ON t.id = o.table_id
    WHERE o.shift_id = p_shift_id AND o.status = 'open' AND NOT COALESCE(o.is_test, false)
    FOR UPDATE OF o
  LOOP
    INSERT INTO public.shift_close_review_items(
      shift_id, business_day, order_id, table_id, kind, status, snapshot
    ) VALUES (
      p_shift_id, v_shift.business_day, v_order.id, v_order.table_id,
      'order_not_finalized', 'pending',
      jsonb_build_object(
        'order_number', v_order.order_number, 'source', v_order.source,
        'table_code', v_order.table_code, 'guests', v_order.guests
      )
    ) ON CONFLICT DO NOTHING;
    v_review_count := v_review_count + 1;

    UPDATE public.orders
    SET status = 'closed', closed_at = COALESCE(closed_at, now())
    WHERE id = v_order.id;
  END LOOP;

  -- Release tables used by this shift.  A table that is already available is
  -- untouched, and no historical rows are deleted.
  FOR v_table IN
    SELECT t.*
    FROM public.restaurant_tables t
    WHERE t.id IN (
      SELECT o.table_id FROM public.orders o
      WHERE o.shift_id = p_shift_id AND o.table_id IS NOT NULL
    )
      AND t.status <> 'available' AND NOT COALESCE(t.is_test, false)
    FOR UPDATE OF t
  LOOP
    INSERT INTO public.shift_close_review_items(
      shift_id, business_day, table_id, kind, status, snapshot,
      resolved_at, resolution
    ) VALUES (
      p_shift_id, v_shift.business_day, v_table.id, 'table_state_not_released',
      'auto_resolved', jsonb_build_object('code', v_table.code, 'status', v_table.status, 'guests', v_table.guests),
      now(), 'Table projection released automatically at Z close'
    ) ON CONFLICT DO NOTHING;
    v_auto_count := v_auto_count + 1;
  END LOOP;

  UPDATE public.restaurant_tables t
  SET status = 'available', guests = 0, has_qr_alert = false
  WHERE t.id IN (SELECT o.table_id FROM public.orders o WHERE o.shift_id = p_shift_id AND o.table_id IS NOT NULL);

  RETURN jsonb_build_object('prepared', true, 'manager_review_count', v_review_count, 'auto_resolved_count', v_auto_count);
END;
$$;

-- Kept for old clients: asking for blockers now prepares a clean close and
-- always returns a non-blocking result.  This is intentionally VOLATILE.
CREATE OR REPLACE FUNCTION public.get_shift_close_blockers(p_shift_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_prepared jsonb;
BEGIN
  v_prepared := public.prepare_shift_for_nonblocking_close(p_shift_id);
  RETURN jsonb_build_object(
    'has_blockers', false,
    'open_orders', '[]'::jsonb,
    'open_bills', '[]'::jsonb,
    'active_tables', '[]'::jsonb,
    'loyalty_issues', '[]'::jsonb,
    'manager_review_count', COALESCE((v_prepared->>'manager_review_count')::integer, 0),
    'auto_resolved_count', COALESCE((v_prepared->>'auto_resolved_count')::integer, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_unsafe_shift_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF old.status = 'open' AND new.status = 'closed' THEN
    PERFORM public.prepare_shift_for_nonblocking_close(new.id);
  END IF;
  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_shift_safely(
  p_shift_id uuid, p_closed_by uuid, p_cash_count jsonb, p_totals jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_shift public.shifts%ROWTYPE; v_prepared jsonb;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift not found'; END IF;
  IF v_shift.status <> 'open' THEN
    RETURN jsonb_build_object('closed', true, 'adopted', true);
  END IF;

  v_prepared := public.prepare_shift_for_nonblocking_close(p_shift_id);
  UPDATE public.shifts SET
    closed_at = now(), closed_by = p_closed_by, status = 'closed',
    cash_count = p_cash_count,
    totals = COALESCE(p_totals, '{}'::jsonb) || jsonb_build_object('close_review', v_prepared)
  WHERE id = p_shift_id;

  RETURN jsonb_build_object(
    'closed', true,
    'manager_review_count', COALESCE((v_prepared->>'manager_review_count')::integer, 0),
    'auto_resolved_count', COALESCE((v_prepared->>'auto_resolved_count')::integer, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.close_shift_with_ticket(
  p_shift_id uuid,
  p_closed_by uuid,
  p_cash_count jsonb,
  p_totals jsonb,
  p_print_payload jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result jsonb;
BEGIN
  v_result := public.close_shift_safely(p_shift_id, p_closed_by, p_cash_count, p_totals);
  IF COALESCE((v_result->>'closed')::boolean, false) AND p_print_payload IS NOT NULL THEN
    PERFORM public.enqueue_print_job(
      'z:' || p_shift_id::text, 'counter', p_print_payload, 'z', p_shift_id, NULL
    );
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_shift_close_review_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'pending_count', count(*) FILTER (WHERE status = 'pending'),
    'items', COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'business_day', business_day, 'kind', kind,
      'expected_amount', expected_amount, 'recorded_amount', recorded_amount,
      'payment_methods', payment_methods, 'created_at', created_at,
      'bill_id', bill_id, 'order_id', order_id, 'table_id', table_id,
      'snapshot', snapshot
    ) ORDER BY business_day DESC, created_at DESC) FILTER (WHERE status = 'pending'), '[]'::jsonb)
  )
  FROM public.shift_close_review_items;
$$;

CREATE OR REPLACE FUNCTION public.mark_shift_close_reviewed(
  p_review_id uuid, p_resolved_by uuid, p_resolution text, p_note text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.staff
    WHERE id = p_resolved_by AND active AND role IN ('admin', 'manager')
  ) THEN
    RAISE EXCEPTION 'Manager authorization required';
  END IF;
  UPDATE public.shift_close_review_items SET
    status = 'reviewed', resolved_at = now(), resolved_by = p_resolved_by,
    resolution = NULLIF(btrim(p_resolution), ''), manager_note = NULLIF(btrim(p_note), '')
  WHERE id = p_review_id AND status = 'pending';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_collected_bill_from_state(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prepare_shift_for_nonblocking_close(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_shift_close_review_summary() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_shift_close_reviewed(uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_shift_close_blockers(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_shift_safely(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_shift_with_ticket(uuid, uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_collected_bill_from_state(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_shift_for_nonblocking_close(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_shift_close_blockers(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_shift_safely(uuid, uuid, jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_shift_with_ticket(uuid, uuid, jsonb, jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_shift_close_review_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_shift_close_reviewed(uuid, uuid, text, text) TO authenticated;
