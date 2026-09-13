CREATE OR REPLACE FUNCTION public.record_manual_member_points(
  p_member_id uuid,
  p_type text,
  p_points integer,
  p_description text,
  p_manager_pin text
)
RETURNS TABLE(balance_after integer, approved_by uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_member public.members%ROWTYPE;
  v_approver public.staff%ROWTYPE;
  v_delta integer;
  v_balance integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_type NOT IN ('earn', 'redeem') THEN
    RAISE EXCEPTION 'Invalid point transaction type';
  END IF;
  IF COALESCE(p_points, 0) <= 0 THEN
    RAISE EXCEPTION 'Points must be greater than zero';
  END IF;
  IF NULLIF(btrim(p_description), '') IS NULL THEN
    RAISE EXCEPTION 'Description is required';
  END IF;

  SELECT * INTO v_approver
  FROM public.staff s
  WHERE s.active
    AND s.role IN ('admin', 'manager')
    AND s.pin_hash = crypt(p_manager_pin, s.pin_hash)
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid manager PIN';
  END IF;

  SELECT * INTO v_member
  FROM public.members
  WHERE id = p_member_id AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active member not found';
  END IF;

  v_delta := CASE WHEN p_type = 'earn' THEN p_points ELSE -p_points END;
  v_balance := COALESCE(v_member.current_points, 0) + v_delta;
  IF v_balance < 0 THEN
    RAISE EXCEPTION 'Not enough points';
  END IF;

  UPDATE public.members
  SET current_points = v_balance, updated_at = now()
  WHERE id = p_member_id;

  INSERT INTO public.member_point_ledger
    (member_id, type, points, balance_after, description, approved_by)
  VALUES
    (p_member_id, p_type, v_delta, v_balance, btrim(p_description), v_approver.id);

  RETURN QUERY SELECT v_balance, v_approver.id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_manual_member_points(uuid, text, integer, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_manual_member_points(uuid, text, integer, text, text)
  TO authenticated;
