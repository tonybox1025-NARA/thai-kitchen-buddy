-- Expose only the staff-tab fields required for X/Z reporting. The underlying
-- tables remain inaccessible to authenticated clients and all reads happen
-- through this narrow security-definer function.
CREATE OR REPLACE FUNCTION public.staff_tab_shift_activity(p_shift_ids uuid[])
RETURNS TABLE(
  activity_type text,
  shift_id uuid,
  staff_id uuid,
  staff_name text,
  amount numeric,
  subtotal numeric,
  discount_amount numeric,
  method text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    'charge'::text,
    c.shift_id,
    c.staff_id,
    s.name,
    c.amount,
    coalesce(c.subtotal, c.amount),
    coalesce(c.discount_amount, 0),
    NULL::text
  FROM public.staff_tab_charges c
  JOIN public.staff s ON s.id = c.staff_id
  WHERE c.shift_id = ANY(p_shift_ids)
    AND c.status <> 'voided'

  UNION ALL

  SELECT
    'settlement'::text,
    x.shift_id,
    x.staff_id,
    s.name,
    x.amount,
    NULL::numeric,
    NULL::numeric,
    x.method
  FROM public.staff_tab_settlements x
  JOIN public.staff s ON s.id = x.staff_id
  WHERE x.shift_id = ANY(p_shift_ids);
$$;

REVOKE ALL ON FUNCTION public.staff_tab_shift_activity(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_tab_shift_activity(uuid[]) TO authenticated;
