-- Removing an unpaid staff charge changes a financial balance. Enforce the
-- manager/owner PIN in the database as well as in the UI so direct RPC calls
-- cannot bypass authorization.

CREATE OR REPLACE FUNCTION public.void_staff_tab_charge_authorized(
  p_charge_id uuid,
  p_manager_pin text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  approver public.staff%ROWTYPE;
BEGIN
  SELECT * INTO approver
  FROM public.staff
  WHERE active = true
    AND role IN ('admin', 'manager')
    AND pin_hash = crypt(p_manager_pin, pin_hash)
  LIMIT 1;

  IF approver.id IS NULL THEN
    RAISE EXCEPTION 'Manager PIN required';
  END IF;

  UPDATE public.staff_tab_charges
  SET status = 'voided',
      voided_at = now(),
      voided_by = approver.id
  WHERE id = p_charge_id
    AND status = 'unpaid';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff charge is not unpaid or no longer exists';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.void_staff_tab_charge_authorized(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_staff_tab_charge_authorized(uuid,text) TO authenticated;

-- The old endpoint trusted the caller-supplied staff id. Keep it defined for
-- migration history, but prevent POS clients from calling it directly.
REVOKE EXECUTE ON FUNCTION public.void_staff_tab_charge(uuid,uuid) FROM authenticated;
