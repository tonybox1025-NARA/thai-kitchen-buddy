-- Qualify every staff-tab charge column because `amount` is also an output
-- parameter of this PL/pgSQL function. Unqualified references are ambiguous.
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
  IF p_method NOT IN ('cash','qr') THEN
    RAISE EXCEPTION 'Payment method must be cash or QR';
  END IF;

  SELECT sh.id
  INTO open_shift
  FROM public.shifts AS sh
  WHERE sh.status = 'open'
  ORDER BY sh.opened_at DESC
  LIMIT 1;
  IF open_shift IS NULL THEN RAISE EXCEPTION 'Open the register first'; END IF;

  PERFORM c.id
  FROM public.staff_tab_charges AS c
  WHERE c.staff_id = p_staff_id AND c.status = 'unpaid'
  FOR UPDATE;

  SELECT coalesce(sum(c.amount), 0)
  INTO total
  FROM public.staff_tab_charges AS c
  WHERE c.staff_id = p_staff_id AND c.status = 'unpaid';
  IF total <= 0 THEN RAISE EXCEPTION 'No outstanding staff tab'; END IF;

  INSERT INTO public.staff_tab_settlements(staff_id, shift_id, amount, method, received_by)
  VALUES (p_staff_id, open_shift, total, p_method, p_received_by)
  RETURNING id INTO created_settlement;

  INSERT INTO public.staff_tab_settlement_items(settlement_id, charge_id, amount)
  SELECT created_settlement, c.id, c.amount
  FROM public.staff_tab_charges AS c
  WHERE c.staff_id = p_staff_id AND c.status = 'unpaid';

  UPDATE public.staff_tab_charges AS c
  SET status = 'paid', settled_at = now()
  WHERE c.staff_id = p_staff_id AND c.status = 'unpaid';

  RETURN QUERY SELECT created_settlement, total;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_staff_tab(uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_staff_tab(uuid,text,uuid) TO authenticated;
