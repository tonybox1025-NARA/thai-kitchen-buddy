CREATE UNIQUE INDEX IF NOT EXISTS member_point_ledger_bill_redeem_key
  ON public.member_point_ledger (bill_id, type)
  WHERE bill_id IS NOT NULL AND type = 'redeem';

CREATE OR REPLACE FUNCTION public.process_bill_loyalty(
  p_bill_id uuid,
  p_member_id uuid,
  p_redeem_points integer,
  p_earn_points integer
)
RETURNS TABLE(balance_after integer, redeemed integer, earned integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill public.bills%ROWTYPE;
  v_balance integer;
  v_existing_member uuid;
  v_redeemed integer := 0;
  v_earned integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF p_member_id IS NULL THEN
    RAISE EXCEPTION 'Member is required';
  END IF;
  IF COALESCE(p_redeem_points, 0) < 0 OR COALESCE(p_earn_points, 0) < 0 THEN
    RAISE EXCEPTION 'Point amounts must not be negative';
  END IF;

  SELECT * INTO v_bill
  FROM public.bills
  WHERE id = p_bill_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;
  IF v_bill.status = 'refunded' THEN
    RAISE EXCEPTION 'Points cannot be processed for this bill status';
  END IF;

  SELECT current_points INTO v_balance
  FROM public.members
  WHERE id = p_member_id AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active member not found';
  END IF;

  SELECT member_id INTO v_existing_member
  FROM public.member_point_ledger
  WHERE bill_id = p_bill_id AND type IN ('redeem', 'earn')
  LIMIT 1;
  IF v_existing_member IS NOT NULL AND v_existing_member <> p_member_id THEN
    RAISE EXCEPTION 'Bill loyalty already belongs to another member';
  END IF;

  SELECT COALESCE(-points, 0) INTO v_redeemed
  FROM public.member_point_ledger
  WHERE bill_id = p_bill_id AND type = 'redeem';
  v_redeemed := COALESCE(v_redeemed, 0);

  IF v_redeemed = 0 AND COALESCE(p_redeem_points, 0) > 0 THEN
    IF v_balance < p_redeem_points THEN
      RAISE EXCEPTION 'Insufficient member points';
    END IF;
    v_balance := v_balance - p_redeem_points;
    v_redeemed := p_redeem_points;
    INSERT INTO public.member_point_ledger
      (member_id, bill_id, type, points, balance_after, description)
    VALUES
      (p_member_id, p_bill_id, 'redeem', -v_redeemed, v_balance,
       'Redeemed on bill ' || p_bill_id::text);
  ELSIF v_redeemed <> COALESCE(p_redeem_points, 0) THEN
    RAISE EXCEPTION 'Bill redemption amount has already been finalized';
  END IF;

  SELECT COALESCE(points, 0) INTO v_earned
  FROM public.member_point_ledger
  WHERE bill_id = p_bill_id AND type = 'earn';
  v_earned := COALESCE(v_earned, 0);

  IF v_earned = 0 AND COALESCE(p_earn_points, 0) > 0 THEN
    v_balance := v_balance + p_earn_points;
    v_earned := p_earn_points;
    INSERT INTO public.member_point_ledger
      (member_id, bill_id, type, points, balance_after, description)
    VALUES
      (p_member_id, p_bill_id, 'earn', v_earned, v_balance,
       'Earned from bill ' || p_bill_id::text);
  ELSIF v_earned <> COALESCE(p_earn_points, 0) THEN
    RAISE EXCEPTION 'Bill earning amount has already been finalized';
  END IF;

  UPDATE public.members
  SET current_points = v_balance, updated_at = now()
  WHERE id = p_member_id;

  UPDATE public.bills
  SET member_id = p_member_id,
      points_redeemed = v_redeemed
  WHERE id = p_bill_id;

  RETURN QUERY SELECT v_balance, v_redeemed, v_earned;
END;
$$;

REVOKE ALL ON FUNCTION public.process_bill_loyalty(uuid, uuid, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_bill_loyalty(uuid, uuid, integer, integer)
  TO authenticated;
