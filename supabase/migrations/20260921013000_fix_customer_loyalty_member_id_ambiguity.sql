-- Qualify bill columns inside the customer loyalty reservation function.
-- The function returns a column named member_id, so unqualified member_id
-- references are otherwise ambiguous to PL/pgSQL.

CREATE OR REPLACE FUNCTION public.reserve_customer_bill_loyalty(
  p_bill_id uuid,
  p_guest_token text,
  p_redeem_points integer
)
RETURNS TABLE(
  member_id uuid,
  member_name text,
  current_points integer,
  reserved_points integer,
  discount_amount numeric,
  available_points integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill public.bills%ROWTYPE;
  v_member public.members%ROWTYPE;
  v_discount numeric(12,2) := 0;
  v_other_reserved integer := 0;
  v_available integer := 0;
BEGIN
  IF p_guest_token IS NULL OR length(p_guest_token) < 20 THEN
    RAISE EXCEPTION 'Wallet is required';
  END IF;

  IF COALESCE(p_redeem_points, 0) NOT IN (0, 500, 1000, 2000, 5000, 10000, 15000) THEN
    RAISE EXCEPTION 'Invalid reward tier';
  END IF;

  v_discount := CASE COALESCE(p_redeem_points, 0)
    WHEN 500 THEN 25
    WHEN 1000 THEN 50
    WHEN 2000 THEN 100
    WHEN 5000 THEN 300
    WHEN 10000 THEN 600
    WHEN 15000 THEN 1000
    ELSE 0
  END;

  SELECT b.* INTO v_bill
  FROM public.bills AS b
  WHERE b.id = p_bill_id
  FOR UPDATE;
  IF NOT FOUND OR v_bill.status <> 'open' THEN
    RAISE EXCEPTION 'Bill is not available';
  END IF;

  SELECT m.* INTO v_member
  FROM public.members AS m
  WHERE m.guest_token = p_guest_token AND m.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member wallet not found';
  END IF;

  SELECT COALESCE(sum(b.points_redeemed), 0)::integer INTO v_other_reserved
  FROM public.bills AS b
  WHERE b.member_id = v_member.id
    AND b.id <> p_bill_id
    AND b.status = 'open'
    AND b.loyalty_reserved_at IS NOT NULL
    AND b.loyalty_reserved_at > now() - interval '30 minutes';

  v_available := GREATEST(0, v_member.current_points - v_other_reserved);
  IF p_redeem_points > v_available THEN
    RAISE EXCEPTION 'Insufficient available points';
  END IF;
  IF v_discount > v_bill.subtotal THEN
    RAISE EXCEPTION 'Reward exceeds bill subtotal';
  END IF;

  UPDATE public.bills AS b
  SET member_id = v_member.id,
      points_redeemed = p_redeem_points,
      loyalty_discount_amount = v_discount,
      loyalty_reserved_at = now(),
      loyalty_reservation_source = 'customer_qr'
  WHERE b.id = p_bill_id;

  RETURN QUERY SELECT
    v_member.id,
    v_member.full_name,
    v_member.current_points,
    p_redeem_points,
    v_discount,
    v_available;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_customer_bill_loyalty(uuid, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_customer_bill_loyalty(uuid, text, integer)
  TO authenticated, service_role;
