-- Staff tabs are cashier-operated. Remove employee PIN friction and record the
-- discounted balance (not the menu subtotal) as the amount due later.

ALTER TABLE public.staff_tab_charges
  ADD COLUMN IF NOT EXISTS subtotal numeric(10,2),
  ADD COLUMN IF NOT EXISTS discount_amount numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_type text,
  ADD COLUMN IF NOT EXISTS discount_value numeric(10,2);

UPDATE public.staff_tab_charges
SET subtotal = amount
WHERE subtotal IS NULL;

ALTER TABLE public.staff_tab_charges
  ALTER COLUMN subtotal SET NOT NULL;

CREATE OR REPLACE FUNCTION public.start_staff_tab_order(
  p_staff_id uuid,
  p_opened_by uuid
)
RETURNS TABLE(order_id uuid, order_number text, staff_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  debtor public.staff%ROWTYPE;
  open_shift uuid;
  next_number integer;
  created_order uuid;
  created_number text;
BEGIN
  SELECT * INTO debtor FROM public.staff WHERE id = p_staff_id AND active;
  IF debtor.id IS NULL THEN RAISE EXCEPTION 'Employee is not active'; END IF;
  SELECT id INTO open_shift FROM public.shifts WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1;
  IF open_shift IS NULL THEN RAISE EXCEPTION 'Open the register first'; END IF;

  SELECT count(*) + 1 INTO next_number FROM public.orders WHERE source = 'staff_meal';
  created_number := 'ST-' || lpad(next_number::text, 3, '0');
  INSERT INTO public.orders(shift_id, source, order_number, opened_by, staff_debtor_id)
  VALUES (open_shift, 'staff_meal', created_number, p_opened_by, p_staff_id)
  RETURNING id INTO created_order;

  RETURN QUERY SELECT created_order, created_number, debtor.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_staff_tab_charge(
  p_order_id uuid,
  p_charged_by uuid,
  p_discount_type text DEFAULT NULL,
  p_discount_value numeric DEFAULT 0
)
RETURNS TABLE(charge_id uuid, amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ord public.orders%ROWTYPE;
  item_subtotal numeric(10,2);
  discount numeric(10,2) := 0;
  final_amount numeric(10,2);
  max_percent numeric(5,2) := 100;
  created_charge uuid;
BEGIN
  SELECT * INTO ord FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF ord.id IS NULL OR ord.source <> 'staff_meal' OR ord.staff_debtor_id IS NULL THEN
    RAISE EXCEPTION 'This is not a named staff order';
  END IF;
  IF ord.status <> 'open' THEN RAISE EXCEPTION 'Staff order is already closed'; END IF;
  IF EXISTS (SELECT 1 FROM public.order_items WHERE order_id = p_order_id AND status = 'pending') THEN
    RAISE EXCEPTION 'Send all items before recording the staff tab';
  END IF;

  SELECT coalesce(sum(qty * unit_price), 0) INTO item_subtotal
  FROM public.order_items WHERE order_id = p_order_id AND status <> 'voided';
  IF item_subtotal <= 0 THEN RAISE EXCEPTION 'Staff order is empty'; END IF;

  SELECT coalesce(max_discount_percent, 100) INTO max_percent FROM public.settings WHERE id = 1;
  IF p_discount_type = 'percent' THEN
    IF p_discount_value < 0 OR p_discount_value > max_percent THEN RAISE EXCEPTION 'Invalid discount percent'; END IF;
    discount := round(item_subtotal * p_discount_value / 100, 2);
  ELSIF p_discount_type = 'fixed' THEN
    IF p_discount_value < 0 THEN RAISE EXCEPTION 'Invalid discount amount'; END IF;
    discount := least(p_discount_value, item_subtotal, round(item_subtotal * max_percent / 100, 2));
  ELSIF p_discount_type IS NOT NULL THEN
    RAISE EXCEPTION 'Discount type must be percent or fixed';
  END IF;

  final_amount := round(item_subtotal - discount, 2);
  IF final_amount <= 0 THEN RAISE EXCEPTION 'Staff tab balance must be greater than zero'; END IF;

  INSERT INTO public.staff_tab_charges(
    order_id, staff_id, shift_id, subtotal, discount_amount,
    discount_type, discount_value, amount, charged_by
  ) VALUES (
    ord.id, ord.staff_debtor_id, ord.shift_id, item_subtotal, discount,
    p_discount_type, CASE WHEN p_discount_type IS NULL THEN NULL ELSE p_discount_value END,
    final_amount, p_charged_by
  ) RETURNING id INTO created_charge;

  UPDATE public.orders SET status = 'closed', closed_at = now() WHERE id = ord.id;
  RETURN QUERY SELECT created_charge, final_amount;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_staff_tab(
  p_staff_id uuid,
  p_method text,
  p_received_by uuid
)
RETURNS TABLE(settlement_id uuid, amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  open_shift uuid;
  total numeric(10,2);
  created_settlement uuid;
BEGIN
  IF p_method NOT IN ('cash','qr') THEN RAISE EXCEPTION 'Payment method must be cash or QR'; END IF;
  SELECT id INTO open_shift FROM public.shifts WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1;
  IF open_shift IS NULL THEN RAISE EXCEPTION 'Open the register first'; END IF;

  PERFORM id FROM public.staff_tab_charges
  WHERE staff_id = p_staff_id AND status = 'unpaid' FOR UPDATE;
  SELECT coalesce(sum(amount), 0) INTO total
  FROM public.staff_tab_charges WHERE staff_id = p_staff_id AND status = 'unpaid';
  IF total <= 0 THEN RAISE EXCEPTION 'No outstanding staff tab'; END IF;

  INSERT INTO public.staff_tab_settlements(staff_id, shift_id, amount, method, received_by)
  VALUES (p_staff_id, open_shift, total, p_method, p_received_by)
  RETURNING id INTO created_settlement;
  INSERT INTO public.staff_tab_settlement_items(settlement_id, charge_id, amount)
  SELECT created_settlement, id, amount FROM public.staff_tab_charges
  WHERE staff_id = p_staff_id AND status = 'unpaid';
  UPDATE public.staff_tab_charges SET status = 'paid', settled_at = now()
  WHERE staff_id = p_staff_id AND status = 'unpaid';
  RETURN QUERY SELECT created_settlement, total;
END;
$$;

REVOKE ALL ON FUNCTION public.start_staff_tab_order(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_staff_tab_charge(uuid,uuid,text,numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settle_staff_tab(uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_staff_tab_order(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_staff_tab_charge(uuid,uuid,text,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_staff_tab(uuid,text,uuid) TO authenticated;

