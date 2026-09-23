-- Allow the cashier to remove an unpaid staff charge from the balance while
-- preserving an audit trail and the original inventory consumption.

ALTER TABLE public.staff_tab_charges
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES public.staff(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.staff_tab_unpaid_details()
RETURNS TABLE(
  charge_id uuid,
  staff_id uuid,
  staff_name text,
  order_number text,
  subtotal numeric,
  discount_amount numeric,
  amount numeric,
  charged_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.staff_id, s.name, o.order_number,
         c.subtotal, c.discount_amount, c.amount, c.charged_at
  FROM public.staff_tab_charges c
  JOIN public.staff s ON s.id = c.staff_id
  JOIN public.orders o ON o.id = c.order_id
  WHERE c.status = 'unpaid'
  ORDER BY c.charged_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.void_staff_tab_charge(
  p_charge_id uuid,
  p_voided_by uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.staff_tab_charges
  SET status = 'voided',
      voided_at = now(),
      voided_by = p_voided_by
  WHERE id = p_charge_id
    AND status = 'unpaid';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff charge is not unpaid or no longer exists';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_tab_unpaid_details() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.void_staff_tab_charge(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_tab_unpaid_details() TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_staff_tab_charge(uuid,uuid) TO authenticated;

