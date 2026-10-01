-- One authoritative get-or-create bill per order. Locks the order so parallel
-- checkout taps/devices adopt the same bill; the unique index stays the final guard.
CREATE OR REPLACE FUNCTION public.get_or_create_bill(p_order_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.orders; v_bill uuid; v_subtotal numeric; v_mode public.vat_mode; v_rate numeric;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  SELECT id INTO v_bill FROM public.bills WHERE order_id = p_order_id LIMIT 1;
  IF v_bill IS NOT NULL THEN RETURN v_bill; END IF;
  SELECT coalesce(sum(qty * unit_price), 0) INTO v_subtotal
    FROM public.order_items WHERE order_id = p_order_id AND status <> 'voided';
  SELECT vat_mode, vat_rate INTO v_mode, v_rate FROM public.settings WHERE id = 1;
  BEGIN
    INSERT INTO public.bills(order_id, shift_id, subtotal, total, vat_mode, vat_rate, is_test)
    VALUES (p_order_id, v_order.shift_id, v_subtotal, v_subtotal, coalesce(v_mode, 'inclusive'), coalesce(v_rate, 7), coalesce(v_order.is_test, false))
    RETURNING id INTO v_bill;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_bill FROM public.bills WHERE order_id = p_order_id LIMIT 1;
  END;
  RETURN v_bill;
END $$;
REVOKE ALL ON FUNCTION public.get_or_create_bill(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_bill(uuid) TO authenticated, service_role;
