-- Combine two open table orders atomically for a single checkout.
-- The target order stays open; the source table is released and its order is
-- retained as a closed shell so historical table provenance is not erased.

CREATE TABLE IF NOT EXISTS public.order_table_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_order_id uuid NOT NULL REFERENCES public.orders(id),
  source_order_id uuid NOT NULL REFERENCES public.orders(id),
  target_table_id uuid NOT NULL REFERENCES public.restaurant_tables(id),
  source_table_id uuid NOT NULL REFERENCES public.restaurant_tables(id),
  source_guests integer NOT NULL DEFAULT 0,
  source_subtotal numeric(12,2) NOT NULL DEFAULT 0,
  merged_by uuid REFERENCES public.staff(id),
  merged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_order_id)
);

ALTER TABLE public.order_table_merges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_table_merges FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can read table merges" ON public.order_table_merges;
CREATE POLICY "authenticated can read table merges"
  ON public.order_table_merges FOR SELECT TO authenticated USING (true);

REVOKE ALL ON TABLE public.order_table_merges FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.order_table_merges TO authenticated;
GRANT ALL ON TABLE public.order_table_merges TO service_role;

CREATE OR REPLACE FUNCTION public.combine_open_table_orders(
  p_target_order_id uuid,
  p_source_order_id uuid,
  p_merged_by uuid DEFAULT NULL
)
RETURNS TABLE(
  source_table_code text,
  combined_guests integer,
  combined_subtotal numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target public.orders%ROWTYPE;
  v_source public.orders%ROWTYPE;
  v_target_table public.restaurant_tables%ROWTYPE;
  v_source_table public.restaurant_tables%ROWTYPE;
  v_target_round integer := 0;
  v_source_subtotal numeric(12,2) := 0;
  v_guests integer := 0;
  v_blocked_bill_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_target_order_id IS NULL OR p_source_order_id IS NULL OR p_target_order_id = p_source_order_id THEN
    RAISE EXCEPTION 'Choose two different tables';
  END IF;

  -- Deterministic order prevents deadlocks when two terminals act together.
  PERFORM 1 FROM public.orders
  WHERE id IN (p_target_order_id, p_source_order_id)
  ORDER BY id
  FOR UPDATE;

  SELECT * INTO v_target FROM public.orders WHERE id = p_target_order_id;
  SELECT * INTO v_source FROM public.orders WHERE id = p_source_order_id;

  IF v_target.id IS NULL OR v_source.id IS NULL THEN
    RAISE EXCEPTION 'Table order not found';
  END IF;
  IF v_target.status <> 'open' OR v_source.status <> 'open' THEN
    RAISE EXCEPTION 'Both tables must still be open';
  END IF;
  IF v_target.table_id IS NULL OR v_source.table_id IS NULL THEN
    RAISE EXCEPTION 'Only table orders can be combined';
  END IF;
  IF v_target.shift_id IS DISTINCT FROM v_source.shift_id THEN
    RAISE EXCEPTION 'Tables belong to different shifts';
  END IF;

  SELECT * INTO v_target_table FROM public.restaurant_tables WHERE id = v_target.table_id FOR UPDATE;
  SELECT * INTO v_source_table FROM public.restaurant_tables WHERE id = v_source.table_id FOR UPDATE;

  -- Combining after checkout work has started can duplicate payments, points,
  -- or discounts. Make staff finish/reverse that workflow explicitly first.
  SELECT count(*) INTO v_blocked_bill_count
  FROM public.bills b
  WHERE b.order_id IN (p_target_order_id, p_source_order_id)
    AND (
      b.status <> 'open'
      OR b.member_id IS NOT NULL
      OR COALESCE(b.points_redeemed, 0) <> 0
      OR COALESCE(b.loyalty_discount_amount, 0) <> 0
      OR COALESCE(b.discount_amount, 0) <> 0
      OR EXISTS (SELECT 1 FROM public.payments p WHERE p.bill_id = b.id)
      OR EXISTS (SELECT 1 FROM public.bill_discounts d WHERE d.bill_id = b.id)
    );
  IF v_blocked_bill_count > 0 THEN
    RAISE EXCEPTION 'Cannot combine after payment, member points, or discounts have started';
  END IF;

  -- Plain, untouched bill drafts are disposable and will be rebuilt from the
  -- combined order when staff opens Payment.
  DELETE FROM public.bills WHERE order_id IN (p_target_order_id, p_source_order_id);

  SELECT COALESCE(max(round_number), 0) INTO v_target_round
  FROM public.order_items
  WHERE order_id = p_target_order_id AND status <> 'voided';

  SELECT COALESCE(sum(qty * unit_price), 0) INTO v_source_subtotal
  FROM public.order_items
  WHERE order_id = p_source_order_id AND status <> 'voided';

  -- Keep every source round together, but place it after existing target rounds.
  UPDATE public.order_items
  SET round_number = round_number + v_target_round
  WHERE order_id = p_source_order_id AND round_number IS NOT NULL;

  UPDATE public.order_items
  SET order_id = p_target_order_id
  WHERE order_id = p_source_order_id;

  v_guests := GREATEST(1, COALESCE(v_target.guests, 0) + COALESCE(v_source.guests, 0));

  UPDATE public.orders
  SET guests = v_guests,
      next_round = GREATEST(
        next_round,
        COALESCE((SELECT max(round_number) + 1 FROM public.order_items WHERE order_id = p_target_order_id), 1)
      ),
      checkout_requested_at = NULL
  WHERE id = p_target_order_id;

  UPDATE public.orders
  SET status = 'closed',
      closed_at = now(),
      closed_by = p_merged_by,
      checkout_requested_at = NULL
  WHERE id = p_source_order_id;

  UPDATE public.restaurant_tables
  SET status = CASE WHEN v_target_table.status = 'bill_requested' THEN 'bill_requested' ELSE 'occupied' END,
      guests = v_guests,
      has_qr_alert = COALESCE(v_target_table.has_qr_alert, false) OR COALESCE(v_source_table.has_qr_alert, false)
  WHERE id = v_target.table_id;

  UPDATE public.restaurant_tables
  SET status = 'available', guests = 0, has_qr_alert = false
  WHERE id = v_source.table_id;

  INSERT INTO public.order_table_merges
    (target_order_id, source_order_id, target_table_id, source_table_id,
     source_guests, source_subtotal, merged_by)
  VALUES
    (p_target_order_id, p_source_order_id, v_target.table_id, v_source.table_id,
     COALESCE(v_source.guests, 0), v_source_subtotal, p_merged_by);

  RETURN QUERY SELECT v_source_table.code, v_guests, v_source_subtotal;
END;
$$;

REVOKE ALL ON FUNCTION public.combine_open_table_orders(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.combine_open_table_orders(uuid, uuid, uuid) TO authenticated, service_role;
